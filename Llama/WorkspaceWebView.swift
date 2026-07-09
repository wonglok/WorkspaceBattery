 import AppKit
 import WebKit
 
 /// Manages a window that shows the workspace web interface in a WKWebView
 /// with a close button for easy dismissal.
 @MainActor
 final class WorkspaceWebViewController: NSObject, NSWindowDelegate {
   static let shared = WorkspaceWebViewController()
 
   private var window: NSWindow?
   private var webView: WKWebView?
 
   private override init() {
     super.init()
   }
 
   func show() {
     // If window exists, just bring it to front
     if let window, window.isVisible {
       NSApp.setActivationPolicy(.regular)
       window.makeKeyAndOrderFront(nil)
       NSApp.activate(ignoringOtherApps: true)
       return
     }
 
     // Create the webview
     let webConfig = WKWebViewConfiguration()
     webConfig.preferences.setValue(true, forKey: "developerExtrasEnabled")
     let wv = WKWebView(frame: .zero, configuration: webConfig)
     wv.translatesAutoresizingMaskIntoConstraints = false
 
     // Load the url
     if let url = URL(string: "http://localhost:8333") {
       wv.load(URLRequest(url: url))
     }
 
     // Wrap in a container that also holds a close button overlay
     let container = NSView()
     container.translatesAutoresizingMaskIntoConstraints = false
     container.addSubview(wv)
 
    //  // Close button in the top-left corner (over the web content)
    //  let closeButton = NSButton()
    //  closeButton.translatesAutoresizingMaskIntoConstraints = false
    //  closeButton.bezelStyle = .rounded
    //  closeButton.isBordered = true
    //  closeButton.title = "Close"
    //  closeButton.contentTintColor = NSColor.labelColor
    //  closeButton.target = self
    //  closeButton.action = #selector(closeWorkspace)
    //  container.addSubview(closeButton)
 
     NSLayoutConstraint.activate([
       wv.leadingAnchor.constraint(equalTo: container.leadingAnchor),
       wv.trailingAnchor.constraint(equalTo: container.trailingAnchor),
       wv.topAnchor.constraint(equalTo: container.topAnchor),
       wv.bottomAnchor.constraint(equalTo: container.bottomAnchor),
 
      //  closeButton.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
      //  closeButton.topAnchor.constraint(equalTo: container.topAnchor, constant: 12),
     ])
 
     // Create the window
     let window = NSWindow(
       contentRect: NSRect(x: 0, y: 0, width: 1024, height: 720),
       styleMask: [.titled, .closable, .miniaturizable, .resizable],
       backing: .buffered,
       defer: false
     )
     window.title = "Workspace"
     window.contentView = container
     window.minSize = NSSize(width: 640, height: 480)
     window.center()
     window.isReleasedWhenClosed = false
     window.delegate = self
 
     self.webView = wv
     self.window = window
 
     // Show window and activate app
     NSApp.setActivationPolicy(.regular)
     window.makeKeyAndOrderFront(nil)
     NSApp.activate(ignoringOtherApps: true)
   }
 
   @objc private func closeWorkspace() {
     window?.close()
   }
 
   func windowWillClose(_ notification: Notification) {
     NSApp.setActivationPolicy(.accessory)
     webView = nil
     window = nil
   }
 }
