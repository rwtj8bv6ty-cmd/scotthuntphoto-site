// Scott Hunt Site Manager: a small native window around the editor in web/.
// The editor (HTML/JS) does all the content work. This file gives it what a browser page can't have:
//   - shp://app/...                 serves the bundled editor files
//   - shp://blob/<owner>/<repo>/<sha> serves a photo from the GitHub repository, cached on disk
//   - window.webkit.messageHandlers.native  config storage, GitHub requests, opening links
import Cocoa
import WebKit

let appName = "Scott Hunt Site Manager"

// MARK: - Storage

enum Store {
    static let supportDir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent(appName, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    static let cacheDir: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent(appName, isDirectory: true).appendingPathComponent("photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()
    static var configURL: URL { supportDir.appendingPathComponent("config.json") }

    // The config holds the GitHub token, so only this user can read it.
    static func loadConfig() -> String {
        (try? String(contentsOf: configURL, encoding: .utf8)) ?? "{}"
    }
    static func saveConfig(_ json: String) {
        try? json.write(to: configURL, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)
    }
    static func token() -> String? {
        guard let data = loadConfig().data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["token"] as? String
    }
}

func mimeType(for data: Data, path: String) -> String {
    let b = [UInt8](data.prefix(12))
    if b.count >= 3 && b[0] == 0xFF && b[1] == 0xD8 { return "image/jpeg" }
    if b.count >= 4 && b[0] == 0x89 && b[1] == 0x50 { return "image/png" }
    if b.count >= 12 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50 { return "image/webp" }
    if b.count >= 4 && b[0] == 0x47 && b[1] == 0x49 { return "image/gif" }
    switch (path as NSString).pathExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "svg": return "image/svg+xml"
    case "json": return "application/json"
    case "png": return "image/png"
    default: return "application/octet-stream"
    }
}

// MARK: - shp:// scheme

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private var stopped = Set<ObjectIdentifier>()
    let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let parts = url.path.split(separator: "/").map(String.init)
        if url.host == "app" {
            var rel = parts.joined(separator: "/")
            if rel.isEmpty { rel = "index.html" }
            let file = webRoot.appendingPathComponent(rel).standardizedFileURL
            guard file.path.hasPrefix(webRoot.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
                return finish(task, status: 404, data: Data("Not found".utf8), type: "text/plain")
            }
            return finish(task, status: 200, data: data, type: mimeType(for: data, path: rel))
        }
        if url.host == "blob", parts.count == 3 {
            let (owner, repo, sha) = (parts[0], parts[1], parts[2])
            guard sha.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil else {
                return finish(task, status: 400, data: Data(), type: "text/plain")
            }
            let cached = Store.cacheDir.appendingPathComponent(sha)
            if let data = try? Data(contentsOf: cached) {
                return finish(task, status: 200, data: data, type: mimeType(for: data, path: ""))
            }
            var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(owner)/\(repo)/git/blobs/\(sha)")!)
            req.setValue("application/vnd.github.raw", forHTTPHeaderField: "Accept")
            if let t = Store.token() { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
            URLSession.shared.dataTask(with: req) { data, resp, _ in
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 500
                let body = data ?? Data()
                if status == 200 { try? body.write(to: cached, options: .atomic) }
                DispatchQueue.main.async {
                    self.finish(task, status: status, data: body, type: mimeType(for: body, path: ""))
                }
            }.resume()
            return
        }
        finish(task, status: 404, data: Data(), type: "text/plain")
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func finish(_ task: WKURLSchemeTask, status: Int, data: Data, type: String) {
        let id = ObjectIdentifier(task)
        if stopped.remove(id) != nil { return }
        let resp = HTTPURLResponse(url: task.request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": type, "Content-Length": "\(data.count)",
                                                  "Cache-Control": "max-age=31536000"])!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }
}

// MARK: - Bridge for the editor

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let msg = message.body as? [String: Any], let cmd = msg["cmd"] as? String else {
            return replyHandler(nil, "bad message")
        }
        switch cmd {
        case "loadConfig":
            replyHandler(Store.loadConfig(), nil)
        case "saveConfig":
            Store.saveConfig(msg["json"] as? String ?? "{}")
            replyHandler(true, nil)
        case "open":
            if let s = msg["url"] as? String, let u = URL(string: s), ["https", "http", "mailto"].contains(u.scheme ?? "") {
                NSWorkspace.shared.open(u)
            }
            replyHandler(true, nil)
        case "clearCache":
            try? FileManager.default.removeItem(at: Store.cacheDir)
            try? FileManager.default.createDirectory(at: Store.cacheDir, withIntermediateDirectories: true)
            replyHandler(true, nil)
        case "http":
            // Only GitHub's API is reachable through here.
            guard let s = msg["url"] as? String, let u = URL(string: s), u.host == "api.github.com" else {
                return replyHandler(nil, "blocked url")
            }
            var req = URLRequest(url: u, timeoutInterval: 120)
            req.httpMethod = msg["method"] as? String ?? "GET"
            for (k, v) in msg["headers"] as? [String: String] ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
            if let t = Store.token() { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
            if let body = msg["body"] as? String { req.httpBody = Data(body.utf8) }
            URLSession.shared.dataTask(with: req) { data, resp, err in
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? (err?.localizedDescription ?? "")
                DispatchQueue.main.async { replyHandler(["status": status, "body": text], nil) }
            }.resume()
        default:
            replyHandler(nil, "unknown command")
        }
    }
}

// MARK: - Window and app

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let schemes = SchemeHandler()
    let bridge = Bridge()

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemes, forURLScheme: "shp")
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = appName
        window.minSize = NSSize(width: 900, height: 600)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("MainWindow")
        window.makeKeyAndOrderFront(nil)
        webView.load(URLRequest(url: URL(string: "shp://app/index.html")!))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // Ask before quitting with changes that haven't been published.
    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        webView.evaluateJavaScript("window.pendingChangeCount ? window.pendingChangeCount() : 0") { result, _ in
            let n = (result as? Int) ?? 0
            if n == 0 { return app.reply(toApplicationShouldTerminate: true) }
            let alert = NSAlert()
            alert.messageText = "You have \(n) unpublished change\(n == 1 ? "" : "s")."
            alert.informativeText = "If you quit now, they will be lost. Use Publish to save them to your website."
            alert.addButton(withTitle: "Keep Editing")
            alert.addButton(withTitle: "Quit Anyway")
            app.reply(toApplicationShouldTerminate: alert.runModal() == .alertSecondButtonReturn)
        }
        return .terminateLater
    }

    // <input type="file"> needs a native picker.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        // "Add folders from Mac…" asks for folders; everything else asks for photos.
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    // Links to the outside world open in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, u.scheme != "shp" {
            NSWorkspace.shared.open(u)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    // Asks first when there are unpublished changes (see reloadFromWebsite in web/app.js).
    @objc func reloadEditor(_ sender: Any?) {
        webView.evaluateJavaScript("window.reloadFromWebsite ? (window.reloadFromWebsite(), 1) : 0") { result, _ in
            if (result as? Int) != 1 { self.webView.reload() }
        }
    }

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let menu = NSMenu(title: title)
            items.forEach(menu.addItem)
            item.submenu = menu
            main.addItem(item)
        }
        func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            return i
        }
        add(appName, [
            item("About \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            item("Hide \(appName)", #selector(NSApplication.hide(_:)), "h"),
            item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            .separator(),
            item("Quit \(appName)", #selector(NSApplication.terminate(_:)), "q"),
        ])
        add("Edit", [
            item("Undo", Selector(("undo:")), "z"),
            item("Redo", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        let reload = item("Reload From Website", #selector(reloadEditor(_:)), "r")
        reload.target = self
        add("View", [reload, item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])])
        add("Window", [
            item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Close", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
