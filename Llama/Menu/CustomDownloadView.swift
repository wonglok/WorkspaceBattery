import AppKit

/// A row with a text field for pasting a Hugging Face model ID and a download button.
/// Accepts `org/repo` or `org/repo:QUANT`, resolves via HFRepoResolver, and starts the download.
/// Sits right below the header for quick access — paste a repo name, tap the arrow (or Enter), and go.
final class CustomDownloadView: ItemView, NSTextFieldDelegate {

  private let textField = NSTextField()
  private let pasteButton = NSButton()
  private let downloadButton = NSButton()

  // Gemma 4 E2B Q4_0
  private let gemmaIcon = IconView()
  private let gemmaLabel = NSTextField()
  private let gemmaButton = NSButton()

  // Gemma 4 26B A4B QAT
  private let gemma26Icon = IconView()
  private let gemma26Label = NSTextField()
  private let gemma26Button = NSButton()

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
    Theme.configure(gemmaButton, symbol: "arrow.down.circle", tooltip: "Download Gemma 4 (E2B Q4_0 GGUF)", pointSize: 20)
    gemmaButton.target = self
    gemmaButton.action = #selector(didClickGemmaDownload)
    gemmaButton.contentTintColor = Theme.Colors.success

    gemmaIcon.imageView.image = NSImage(named: "ModelLogos/gemma")
    gemmaIcon.inactiveTintColor = Theme.Colors.modelIconTint

    gemmaLabel.stringValue = "Download Gemma 4 E2B Q4_0"
    gemmaLabel.font = Theme.Fonts.secondary
    gemmaLabel.textColor = Theme.Colors.textPrimary
    gemmaLabel.isEditable = false
    gemmaLabel.isSelectable = false
    gemmaLabel.isBordered = false
    gemmaLabel.backgroundColor = .clear
    gemmaLabel.translatesAutoresizingMaskIntoConstraints = false
    gemmaLabel.lineBreakMode = .byTruncatingTail

    // --- Gemma 4 26B A4B QAT ---
    Theme.configure(gemma26Button, symbol: "arrow.down.circle", tooltip: "Download Gemma 4 (26B A4B QAT GGUF)", pointSize: 20)
    gemma26Button.target = self
    gemma26Button.action = #selector(didClickGemma26Download)
    gemma26Button.contentTintColor = Theme.Colors.success

    gemma26Icon.imageView.image = NSImage(named: "ModelLogos/gemma")
    gemma26Icon.inactiveTintColor = Theme.Colors.modelIconTint

    gemma26Label.stringValue = "Download Gemma 4 26B A4B QAT"
    gemma26Label.font = Theme.Fonts.secondary
    gemma26Label.textColor = Theme.Colors.textPrimary
    gemma26Label.isEditable = false
    gemma26Label.isSelectable = false
    gemma26Label.isBordered = false
    gemma26Label.backgroundColor = .clear
    gemma26Label.translatesAutoresizingMaskIntoConstraints = false
    gemma26Label.lineBreakMode = .byTruncatingTail

    // --- Layout ---
    let topRow = NSStackView(views: [textField, pasteButton, downloadButton])
    topRow.orientation = .horizontal
    topRow.spacing = 6
    topRow.alignment = .centerY

    let spacer = NSView()
    spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
    spacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    let gemmaRow = NSStackView(views: [gemmaIcon, gemmaLabel, spacer, gemmaButton])
    gemmaRow.orientation = .horizontal
    gemmaRow.spacing = 6
    gemmaRow.alignment = .centerY

    let spacer26 = NSView()
    spacer26.setContentHuggingPriority(.defaultLow, for: .horizontal)
    spacer26.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    let gemma26Row = NSStackView(views: [gemma26Icon, gemma26Label, spacer26, gemma26Button])
    gemma26Row.orientation = .horizontal
    gemma26Row.spacing = 6
    gemma26Row.alignment = .centerY

    let rootStack = NSStackView(views: [topRow, gemmaRow, gemma26Row])
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

    // Gemma 4 E2B
    gemmaButton.widthAnchor.constraint(equalToConstant: 28).isActive = true
    gemmaButton.heightAnchor.constraint(equalTo: gemmaButton.widthAnchor).isActive = true
    gemmaButton.setContentHuggingPriority(.required, for: .horizontal)
    gemmaButton.setContentCompressionResistancePriority(.required, for: .horizontal)
    gemmaLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
    gemmaLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    // Gemma 4 26B
    gemma26Button.widthAnchor.constraint(equalToConstant: 28).isActive = true
    gemma26Button.heightAnchor.constraint(equalToConstant: 28).isActive = true
    gemma26Button.setContentHuggingPriority(.required, for: .horizontal)
    gemma26Button.setContentCompressionResistancePriority(.required, for: .horizontal)
    gemma26Label.setContentHuggingPriority(.defaultHigh, for: .horizontal)
    gemma26Label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
  }

  // MARK: - Event forwarding

  override func hitTest(_ point: NSPoint) -> NSView? {
    // The menu item is disabled (so the menu doesn't close on click), which
    // prevents the text field from receiving mouse events through the normal
    // responder chain. Override hitTest so clicks on the text field or the
    // download button dispatch directly to those subviews, letting them handle
    // first-responder acquisition, text selection, and paste naturally.
    for target in [textField, pasteButton, downloadButton, gemmaButton, gemma26Button] as [NSView] {
      let local = target.convert(point, from: self)
      if target.bounds.contains(local) {
        return target
      }
    }
    return super.hitTest(point)
  }

  // MARK: - Actions

  override func mouseDown(with event: NSEvent) {
    // Fallback: ensure the text field grabs focus even when hitTest doesn't
    // resolve to it (e.g. clicks on the padding area around it).
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

  @objc private func didClickGemmaDownload() {
    onInstall("google/gemma-4-E2B-it-qat-q4_0-gguf", nil)
    textField.stringValue = ""
  }

  @objc private func didClickGemma26Download() {
    onInstall("google/gemma-4-26B-A4B-it-qat-q4_0-gguf", nil)
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

    // Parse "org/repo:QUANT" or just "org/repo"
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

    // Basic validation: must contain a slash (org/repo format)
    guard repo.contains("/") else {
      NSSound.beep()
      return
    }

    textField.stringValue = ""

    onInstall(repo, quant)
  }
}
