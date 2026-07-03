declare module "nativefiledialog-for-bun" {
  export function pickFolder(): Promise<string | null>;
  export function pickFile(options?: {
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
  export function pickSave(options?: {
    defaultName?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | null>;
}
