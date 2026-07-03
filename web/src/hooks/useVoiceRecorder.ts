import { useState, useRef, useCallback } from "react";
import lamejs from "lamejs";

function audioBufferToMp3(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);

  const left = buffer.getChannelData(0);
  const right = numChannels > 1 ? buffer.getChannelData(1) : left;

  // Convert Float32 [-1,1] to Int16
  const leftInt = new Int16Array(left.length);
  const rightInt = new Int16Array(right.length);
  for (let i = 0; i < left.length; i++) {
    const s = Math.max(-1, Math.min(1, left[i]));
    leftInt[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  for (let i = 0; i < right.length; i++) {
    const s = Math.max(-1, Math.min(1, right[i]));
    rightInt[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const mp3Data: Int8Array[] = [];
  const blockSize = 1152;
  for (let i = 0; i < leftInt.length; i += blockSize) {
    const leftChunk = leftInt.subarray(i, i + blockSize);
    const rightChunk = rightInt.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(leftChunk, rightChunk);
    if (encoded.length > 0) mp3Data.push(encoded);
  }
  const final = encoder.flush();
  if (final.length > 0) mp3Data.push(final);

  return new Blob(mp3Data as any, { type: "audio/mp3" });
}

async function blobToMp3(blob: Blob): Promise<Blob> {
  const audioCtx = new AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return audioBufferToMp3(audioBuffer);
  } finally {
    audioCtx.close();
  }
}

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    navigator.mediaDevices != null &&
    typeof MediaRecorder !== "undefined";

  const startRecording = useCallback(async () => {
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);

    recorder.start();
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;

      recorder.onstop = async () => {
        const webmBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType,
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        setIsRecording(false);

        try {
          const mp3Blob = await blobToMp3(webmBlob);
          resolve(mp3Blob);
        } catch {
          resolve(webmBlob);
        }
      };

      recorder.stop();
    });
  }, []);

  const getBase64Audio = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }, []);

  return {
    isRecording,
    isSupported,
    duration,
    startRecording,
    stopRecording,
    getBase64Audio,
  };
}
