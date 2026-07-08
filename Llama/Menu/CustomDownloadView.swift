import AppKit

/// A row with a text field for pasting a Hugging Face model ID and a download button.
/// Accepts `org/repo` or `org/repo:QUANT`, resolves via HFRepoResolver, and starts the download.
/// Sits right below the header for quick access — paste a repo name, tap the arrow (or Enter), and go.
final class CustomDownloadView: ItemView, NSTextFieldDelegate {

  private let textField = NSTextField()
  private let pasteButton = NSButton()
  private let downloadButton = NSButton()

  // Gemma 4 E2B Q4_0
  private let gemmaE2BIcon = IconView()
  private let gemmaE2BLabel = NSTextField()
  private let gemmaE2BButton = NSButton()

  // Gemma 4 E4B Q4_0
  private let gemmaE4BIcon = IconView()
  private let gemmaE4BLabel = NSTextField()
  private let gemmaE4BButton = NSButton()

  private let onInstall: (String, String?) -> Void

  init(onInstall: @escaping (String, String?) -> Void) {
    self.onInstall = onInstall
    super.init(frame: .zero)
    setup()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var highlightEnabled: Bool { false }

  private func setup() {
    textField.placeholderString = "Paste model ID (e.g. bartowski/Meta-Llama-3.1-8B)"
    textField.font = Theme.Fonts.secondary
    textField.bezelStyle = .roundedBezel
    textField.isEditable = true
    textField.isSelectable = true
    textField.delegate = self
    textField.translatesAutoresizingMaskIntoConstraints = false
    textField.lineBreakMode = .byTruncatingHead
    textField.focusRingType = .default
    textField.textColor = .controlTextColor

    Theme.configure(downloadButton, symbol: "arrow.down.circle", tooltip: "Download model")
    downloadButton.target = self
    downloadButton.action = #selector(didClickDownload)
    downloadButton.contentTintColor = Theme.Colors.success

    Theme.configure(pasteButton, symbol: "doc.on.clipboard", tooltip: "Paste from clipboard")
    pasteButton.target = self
    pasteButton.action = #selector(didClickPaste)

    // --- Gemma 4 E2B Q4_0 ---
    Theme.configure(gemmaE2BButton, symbol: "arrow.down.circle", tooltip: "Download Gemma 4 (E2B Q4_0 GGUF)", pointSize: 20)
    gemmaE2BButton.target = self
    gemmaE2BButton.action = #selector(didClickGemmaE2BDownload)
    gemmaE2BButton.contentTintColor = Theme.Colors.success

    gemmaE2BIcon.imageView.image = NSImage(named: "ModelLogos/gemma")
    gemmaE2BIcon.inactiveTintColor = Theme.Colors.modelIconTint

    gemmaE2BLabel.stringValue = "Download Gemma 4 E2B Q4_0"
    gemmaE2BLabel.font = Theme.Fonts.secondary
    gemmaE2BLabel.textColor = Theme.Colors.textPrimary
    gemmaE2BLabel.isEditable = false
    gemmaE2BLabel.isSelectable = false
    gemmaE2BLabel.isBordered = false
    gemmaE2BLabel.backgroundColor = .clear
    gemmaE2BLabel.translatesAutoresizingMaskIntoConstraints = false
    gemmaE2BLabel.lineBreakMode = .byTruncatingTail

    // --- Gemma 4 E4B Q4_0 ---
    Theme.configure(gemmaE4BButton, symbol: "arrow.down.circle", tooltip: "Download Gemma 4 (E4B Q4_0 GGUF)", pointSize: 20)
    gemmaE4BButton.target = self
    gemmaE4BButton.action = #selector(didClickGemmaE4BDownload)
    gemmaE4BButton.contentTintColor = Theme.Colors.success

    gemmaE4BIcon.imageView.image = NSImage(named: "ModelLogos/gemma")
    gemmaE4BIcon.inactiveTintColor = Theme.Colors.modelIconTint

    gemmaE4BLabel.stringValue = "Download Gemma 4 E4B Q4_0"
    gemmaE4BLabel.font = Theme.Fonts.secondary
    gemmaE4BLabel.textColor = Theme.Colors.textPrimary
    gemmaE4BLabel.isEditable = false
    gemmaE4BLabel.isSelectable = false
    gemmaE4BLabel.isBordered = false
    gemmaE4BLabel.backgroundColor = .clear
    gemmaE4BLabel.translatesAutoresizingMaskIntoConstraints = false
    gemmaE4BLabel.lineBreakMode = .byTruncatingTail

    // --- Layout ---
    let topRow = NSStackView(views: [textField, pasteButton, downloadButton])
    topRow.orientation = .horizontal
    topRow.spacing = 6
    topRow.alignment = .centerY

    let spacerE2B = NSView()
    spacerE2B.setContentHuggingPriority(.defaultLow, for: .horizontal)
    spacerE2B.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    let gemmaE2BRow = NSStackView(views: [gemmaE2BIcon, gemmaE2BLabel, spacerE2B, gemmaE2BButton])
    gemmaE2BRow.orientation = .horizontal
    gemmaE2BRow.spacing = 6
    gemmaE2BRow.alignment = .centerY
    let clickE2B = NSClickGestureRecognizer(target: self, action: #selector(didClickGemmaE2BDownload))
    clickE2B.buttonMask = 0x1
    gemmaE2BRow.addGestureRecognizer(clickE2B)

    let spacerE4B = NSView()
    spacerE4B.setContentHuggingPriority(.defaultLow, for: .horizontal)
    spacerE4B.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    let gemmaE4BRow = NSStackView(views: [gemmaE4BIcon, gemmaE4BLabel, spacerE4B, gemmaE4BButton])
    gemmaE4BRow.orientation = .horizontal
    gemmaE4BRow.spacing = 6
    gemmaE4BRow.alignment = .centerY
    let clickE4B = NSClickGestureRecognizer(target: self, action: #selector(didClickGemmaE4BDownload))
    clickE4B.buttonMask = 0x1
    gemmaE4BRow.addGestureRecognizer(clickE4B)

    let rootStack = NSStackView(views: [topRow, gemmaE2BRow, gemmaE4BRow])
    rootStack.orientation = .vertical
    rootStack.spacing = 4
    rootStack.alignment = .leading

    contentView.addSubview(rootStack)
    rootStack.pinToSuperview()

    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: Layout.menuWidth),
      heightAnchor.constraint(equalToConstant: 92),
    ])

    Layout.constrainToIconSize(downloadButton)
    downloadButton.setContentHuggingPriority(.required, for: .horizontal)
    downloadButton.setContentCompressionResistancePriority(.required, for: .horizontal)
    Layout.constrainToIconSize(pasteButton)
    pasteButton.setContentHuggingPriority(.required, for: .horizontal)
    pasteButton.setContentCompressionResistancePriority(.required, for: .horizontal)

    // Gemma 4 E2B Q4_0
    gemmaE2BButton.widthAnchor.constraint(equalToConstant: 28).isActive = true
    gemmaE2BButton.heightAnchor.constraint(equalTo: gemmaE2BButton.widthAnchor).isActive = true
    gemmaE2BButton.setContentHuggingPriority(.required, for: .horizontal)
    gemmaE2BButton.setContentCompressionResistancePriority(.required, for: .horizontal)
    gemmaE2BLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
    gemmaE2BLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    // Gemma 4 E4B Q4_0
    gemmaE4BButton.widthAnchor.constraint(equalToConstant: 28).isActive = true
    gemmaE4BButton.heightAnchor.constraint(equalTo: gemmaE4BButton.widthAnchor).isActive = true
    gemmaE4BButton.setContentHuggingPriority(.required, for: .horizontal)
    gemmaE4BButton.setContentCompressionResistancePriority(.required, for: .horizontal)
    gemmaE4BLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
    gemmaE4BLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
  }

  // MARK: - Event forwarding

  override func hitTest(_ point: NSPoint) -> NSView? {
    for target in [textField, pasteButton, downloadButton, gemmaE2BButton, gemmaE4BButton] as [NSView] {
      let local = target.convert(point, from: self)
      if target.bounds.contains(local) {
        return target
      }
    }
    return super.hitTest(point)
  }

  // MARK: - Actions

  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(textField)
  }

  @objc private func didClickPaste() {
    let pasteboard = NSPasteboard.general
    guard let text = pasteboard.string(forType: .string) else { return }
    textField.stringValue = text
    window?.makeFirstResponder(textField)
  }

  @objc private func didClickDownload() {
    performDownload()
  }

  @objc private func didClickGemmaE2BDownload() {
    onInstall("google/gemma-4-E2B-it-qat-q4_0-gguf", nil)
    textField.stringValue = ""
  }

  @objc private func didClickGemmaE4BDownload() {
    onInstall("google/gemma-4-E4B-it-qat-q4_0-gguf", nil)
    textField.stringValue = ""
  }

  func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
    if commandSelector == #selector(insertNewline(_:)) {
      performDownload()
      return true
    }
    return false
  }

  private func performDownload() {
    let raw = textField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !raw.isEmpty else { return }

    let parts = raw.split(separator: ":", maxSplits: 1)
    let repo: String
    let quant: String?

    if parts.count == 2 {
      repo = String(parts[0])
      quant = String(parts[1])
    } else {
      repo = raw
      quant = nil
    }

    guard repo.contains("/") else {
      NSSound.beep()
      return
    }

    textField.stringValue = ""

    onInstall(repo, quant)
  }
}
