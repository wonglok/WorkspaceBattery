import AppKit
import Foundation

/// Header row showing app name and server status.
final class HeaderView: ItemView {

  private unowned let server: LlamaServer
  private let appNameLabel = Theme.primaryLabel()
  private let restartIcon = NSImageView()
  private let statusStackView = NSStackView()
  private let linkLabel = Theme.secondaryLabel()
  private let copyButton = NSButton()
  private let openWorkspaceButton = NSButton()

  private var currentUrl: URL?
  private var showingCopyConfirmation = false
  private var showingRestartIcon = false
  private var restartIconHideTask: DispatchWorkItem?

  init(server: LlamaServer) {
    self.server = server
    super.init(frame: .zero)
    setup()
    refresh()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var highlightEnabled: Bool { false }

  private func setup() {
    widthAnchor.constraint(equalToConstant: Layout.menuWidth).isActive = true

    appNameLabel.stringValue = "Workspace Battery"

    // Restart icon -- shown briefly while server is restarting
    Theme.configure(restartIcon, symbol: "arrow.trianglehead.2.clockwise", pointSize: 11)
    restartIcon.contentTintColor = NSColor.labelColor
    restartIcon.isHidden = true

    // Title stack for horizontal layout of app name and restart icon
    let titleStack = NSStackView(views: [appNameLabel, restartIcon, NSView.flexibleSpacer(), openWorkspaceButton])
    titleStack.orientation = .horizontal
    titleStack.spacing = 6
    titleStack.alignment = .centerY

    // Status stack for horizontal layout of status elements
    statusStackView.translatesAutoresizingMaskIntoConstraints = false
    statusStackView.orientation = .horizontal
    statusStackView.spacing = 0
    statusStackView.alignment = .firstBaseline
    statusStackView.distribution = .fill

    // Main stack for vertical layout of title row and status
    let mainStack = NSStackView(views: [titleStack])
    mainStack.orientation = .vertical
    mainStack.alignment = .centerX
    mainStack.spacing = Layout.textLineSpacing

    contentView.addSubview(mainStack)
    mainStack.pinToSuperview()

    // Link Label Configuration
    linkLabel.isSelectable = false  // Make it look like a label, not editable

    // // Copy Button Configuration
    // Theme.configure(copyButton, symbol: "doc.on.doc", tooltip: "Copy URL", pointSize: 11)
    // copyButton.target = self
    // copyButton.action = #selector(copyUrl)

    // Open Workspace Button Configuration
    openWorkspaceButton.title = "Open Workspace"
    openWorkspaceButton.bezelStyle = .rounded
    openWorkspaceButton.isBordered = true
      openWorkspaceButton.controlSize = .large
    openWorkspaceButton.contentTintColor = NSColor.linkColor
    openWorkspaceButton.font = Theme.Fonts.secondary
    openWorkspaceButton.target = self
    openWorkspaceButton.action = #selector(openWorkspaceClicked)
    openWorkspaceButton.translatesAutoresizingMaskIntoConstraints = false

    statusStackView.addArrangedSubview(linkLabel)
    statusStackView.addArrangedSubview(NSView.spacer(width: 4))
    // statusStackView.addArrangedSubview(copyButton)
    statusStackView.addArrangedSubview(NSView.spacer(width: 8))
    statusStackView.addArrangedSubview(NSView.flexibleSpacer())
  }

  func refresh() {
    // Show restart icon in debug builds only -- useful for development but
    // exposes implementation details that users don't need to see
    #if DEBUG
      if server.isLoading && !showingRestartIcon {
        showingRestartIcon = true
        restartIconHideTask?.cancel()
        restartIcon.isHidden = false
      } else if !server.isLoading && showingRestartIcon {
        // Delay hiding to ensure icon is visible for at least 250ms
        restartIconHideTask?.cancel()
        let task = DispatchWorkItem { [weak self] in
          self?.showingRestartIcon = false
          self?.restartIcon.isHidden = true
        }
        restartIconHideTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: task)
      }
    #endif

    // Connect to server info
    appNameLabel.stringValue = "Workspace Battery"

    // A hard server error (e.g. the port is held by another app) means there's
    // Surface the error state.
    if case .error(let err) = server.state {
      linkLabel.isHidden = true
      copyButton.isHidden = true
      needsDisplay = true
      return
    }

    // // Build server URLs using the resolved host (handles 0.0.0.0 -> local IP)
    // let host = LlamaServer.resolvedHost
    // let linkText = "\(host):\(LlamaServer.port)"
    // let apiUrlString = "http://\(linkText)/v1"

    // self.currentUrl = URL(string: apiUrlString)!


    // let displayString = apiUrlString.replacingOccurrences(of: "http://", with: "")
    // let attrTitle = NSAttributedString(
    //   string: displayString,
    //   attributes: [
    //     .foregroundColor: Theme.Colors.textPrimary,
    //     .font: Theme.Fonts.secondary,
    //   ]
    // )
    // linkLabel.attributedStringValue = attrTitle
    // linkLabel.isHidden = false
    // copyButton.isHidden = false


    // Update copy icon based on confirmation state
    // Theme.updateCopyIcon(copyButton, showingConfirmation: showingCopyConfirmation)

    needsDisplay = true
  }


  @objc private func openWorkspaceClicked() {
    openInBrowser(URL(string: "http://localhost:8333/")!)
  }

  @objc private func copyUrl() {
    if let url = currentUrl {
      Clipboard.copy(url.absoluteString)

      // Show checkmark confirmation
      showingCopyConfirmation = true
      refresh()

      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
        self?.showingCopyConfirmation = false
        self?.refresh()
      }
    }
  }

}
