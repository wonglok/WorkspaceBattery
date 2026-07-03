 import AppKit
 
 /// A row with a text field for pasting a Hugging Face model ID and a download button.
 /// Accepts `org/repo` or `org/repo:QUANT`, resolves via HFRepoResolver, and starts the download.
 /// Sits right below the header for quick access — paste a repo name, tap the arrow (or Enter), and go.
 final class CustomDownloadView: ItemView, NSTextFieldDelegate {
 
  private let textField = NSTextField()
  private let pasteButton = NSButton()
  private let downloadButton = NSButton()
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

     let rootStack = NSStackView(views: [textField, pasteButton, downloadButton])
     rootStack.orientation = .horizontal
     rootStack.spacing = 6
     rootStack.alignment = .centerY
 
     contentView.addSubview(rootStack)
     rootStack.pinToSuperview()
 
     NSLayoutConstraint.activate([
       widthAnchor.constraint(equalToConstant: Layout.menuWidth),
       heightAnchor.constraint(equalToConstant: 32),
     ])
 
    Layout.constrainToIconSize(downloadButton)
    downloadButton.setContentHuggingPriority(.required, for: .horizontal)
    downloadButton.setContentCompressionResistancePriority(.required, for: .horizontal)
    Layout.constrainToIconSize(pasteButton)
    pasteButton.setContentHuggingPriority(.required, for: .horizontal)
    pasteButton.setContentCompressionResistancePriority(.required, for: .horizontal)
   }
 
   // MARK: - Event forwarding
 
   override func hitTest(_ point: NSPoint) -> NSView? {
     // The menu item is disabled (so the menu doesn't close on click), which
     // prevents the text field from receiving mouse events through the normal
     // responder chain. Override hitTest so clicks on the text field or the
     // download button dispatch directly to those subviews, letting them handle
     // first-responder acquisition, text selection, and paste naturally.
     for target in [textField, pasteButton, downloadButton] as [NSView] {
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
