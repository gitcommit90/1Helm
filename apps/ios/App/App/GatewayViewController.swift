import UIKit
import Capacitor
import WebKit
import SafariServices
import CoreLocation
import AVFAudio

private let gatewayServerKey = "onehelm.selected.https.origin"

private func validatedGatewayOrigin(_ raw: String?) -> String? {
    guard let raw, let components = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
          components.scheme?.lowercased() == "https", components.host != nil,
          components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
          components.path.isEmpty || components.path == "/" else { return nil }
    var root = components; root.path = ""; return root.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
}

@objc(InstanceGatewayPlugin)
class InstanceGatewayPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "InstanceGatewayPlugin"
    let jsName = "InstanceGateway"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selectServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativePermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLocation", returnType: CAPPluginReturnPromise)
    ]

    // Location and microphone through iOS itself (see nativePermissionShim): the web view forgets a page's location and microphone
    // permission every time the app restarts, so the page asked again on every launch and showed a second WebKit location prompt.
    @objc func nativePermissions(_ call: CAPPluginCall) {
        call.resolve(["location": locationState(), "microphone": microphoneState()])
    }

    private var locators: [OneShotLocator] = []
    @objc func getLocation(_ call: CAPPluginCall) {
        let precise = call.getBool("high") ?? false
        DispatchQueue.main.async {
            var locator: OneShotLocator!
            locator = OneShotLocator(precise: precise) { [weak self] result in
                self?.locators.removeAll { $0 === locator }
                switch result {
                case .success(let place):
                    call.resolve(["lat": place.coordinate.latitude, "lng": place.coordinate.longitude, "accuracy": place.horizontalAccuracy,
                                  "at": place.timestamp.timeIntervalSince1970 * 1000])
                case .failure(let problem): call.reject(problem.message, problem.code)
                }
            }
            self.locators.append(locator)
            locator.start()
        }
    }

    @objc func getServer(_ call: CAPPluginCall) {
        call.resolve(["origin": validatedGatewayOrigin(UserDefaults.standard.string(forKey: gatewayServerKey)) ?? ""])
    }

    @objc func selectServer(_ call: CAPPluginCall) {
        guard let origin = validatedGatewayOrigin(call.getString("origin")) else { call.reject("Choose a valid HTTPS root address."); return }
        UserDefaults.standard.set(origin, forKey: gatewayServerKey); call.resolve(["origin": origin]); replaceGatewayRoot()
    }

    @objc func clearServer(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: gatewayServerKey); call.resolve(); replaceGatewayRoot()
    }

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else { return NSNumber(value: true) }
        if scheme == "data" || scheme == "blob" { return NSNumber(value: false) }
        guard scheme == "http" || scheme == "https" else { return nil }
        let selected = validatedGatewayOrigin(UserDefaults.standard.string(forKey: gatewayServerKey))
        let local = bridge?.config.localURL
        let exactSelected = selected.flatMap(URL.init(string:)).map { sameOrigin(url, $0) } ?? false
        let exactLocal = local.map { sameOrigin(url, $0) } ?? false
        // Do not rely on Capacitor's URL-prefix navigation check here: exact
        // origin comparison prevents `selected.example.evil` from inheriting
        // the selected instance's native bridge.
        if exactSelected || exactLocal { return NSNumber(value: false) }
        // Anything else (Terms, Privacy, help pages, links in messages) that the person tapped opens in a Safari
        // sheet over the app instead of doing nothing; it never loads inside the app. Links that open a new
        // window already go to Safari through Capacitor.
        if navigationAction.navigationType == .linkActivated, navigationAction.targetFrame?.isMainFrame != false {
            DispatchQueue.main.async { [weak self] in
                guard let presenter = self?.bridge?.viewController else { return }
                presenter.present(SFSafariViewController(url: url), animated: true)
            }
        }
        return NSNumber(value: true)
    }

    private func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        let left = URLComponents(url: lhs, resolvingAgainstBaseURL: false)
        let right = URLComponents(url: rhs, resolvingAgainstBaseURL: false)
        let port: (URLComponents?) -> Int? = { components in
            if let explicit = components?.port { return explicit }
            if components?.scheme?.lowercased() == "https" { return 443 }
            if components?.scheme?.lowercased() == "http" { return 80 }
            return nil
        }
        return left?.scheme?.lowercased() == right?.scheme?.lowercased()
            && left?.host?.lowercased() == right?.host?.lowercased()
            && port(left) == port(right)
    }

    private func replaceGatewayRoot() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            let window = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first
            window?.rootViewController = GatewayViewController(); window?.makeKeyAndVisible()
        }
    }
}

private func locationState() -> String {
    switch CLLocationManager().authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways: return "granted"
    case .denied, .restricted: return "denied"
    default: return "prompt"
    }
}

private func microphoneState() -> String {
    if #available(iOS 17.0, *) {
        switch AVAudioApplication.shared.recordPermission {
        case .granted: return "granted"
        case .denied: return "denied"
        default: return "prompt"
        }
    }
    switch AVAudioSession.sharedInstance().recordPermission {
    case .granted: return "granted"
    case .denied: return "denied"
    default: return "prompt"
    }
}

struct LocationProblem: Error { let message: String; let code: String }

// One location fix from iOS, asking for "While Using the App" permission first if it was never asked.
final class OneShotLocator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var done: ((Result<CLLocation, LocationProblem>) -> Void)?
    private var timer: Timer?

    init(precise: Bool, done: @escaping (Result<CLLocation, LocationProblem>) -> Void) {
        self.done = done
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = precise ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
    }

    func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            self?.finish(.failure(LocationProblem(message: "Location timed out.", code: "TIMEOUT")))
        }
        decide()
    }

    private func decide() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()   // answered in locationManagerDidChangeAuthorization
        case .denied, .restricted: finish(.failure(LocationProblem(message: "Location permission denied.", code: "DENIED")))
        default: manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if done != nil && manager.authorizationStatus != .notDetermined { decide() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let place = locations.last { finish(.success(place)) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .locationUnknown { return }   // iOS keeps trying; wait for the next update or the timer
        let denied = (error as? CLError)?.code == .denied
        finish(.failure(LocationProblem(message: denied ? "Location permission denied." : "Location unavailable.", code: denied ? "DENIED" : "UNAVAILABLE")))
    }

    private func finish(_ result: Result<CLLocation, LocationProblem>) {
        timer?.invalidate(); timer = nil
        guard let callback = done else { return }
        done = nil
        callback(result)
    }
}

// Runs before the page's own scripts, in the selected server's pages only (the bridge exists only there). navigator.geolocation
// and the Permissions API answers for location and microphone come from iOS, which remembers them, instead of the web view,
// which forgets them on every launch. Everything else is left to the web view.
private let nativePermissionShim = """
(function () {
  if (window.__onehelmNative) return; window.__onehelmNative = true;
  var plugin = function () { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.InstanceGateway; };
  var failure = function (code, message) { return { code: code, message: message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }; };
  var getCurrentPosition = function (ok, fail, options) {
    var p = plugin(); if (!p) { if (fail) fail(failure(2, "Location unavailable.")); return; }
    p.getLocation({ high: !!(options && options.enableHighAccuracy) }).then(function (r) {
      if (ok) ok({ coords: { latitude: r.lat, longitude: r.lng, accuracy: r.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: r.at || Date.now() });
    }).catch(function (e) {
      var code = e && e.code === "DENIED" ? 1 : e && e.code === "TIMEOUT" ? 3 : 2;
      if (fail) fail(failure(code, (e && e.message) || "Location unavailable."));
    });
  };
  var watches = 0;
  var geolocation = { getCurrentPosition: getCurrentPosition, watchPosition: function (ok, fail, options) { getCurrentPosition(ok, fail, options); return ++watches; }, clearWatch: function () {} };
  try { Object.defineProperty(Navigator.prototype, "geolocation", { configurable: true, get: function () { return geolocation; } }); } catch (e) {}
  var perms = navigator.permissions, query = perms && perms.query && perms.query.bind(perms);
  if (query) perms.query = function (d) {
    var name = d && d.name, p = plugin();
    if ((name === "geolocation" || name === "microphone") && p) {
      return p.nativePermissions().then(function (s) {
        return { name: name, state: name === "geolocation" ? s.location : s.microphone, onchange: null, addEventListener: function () {}, removeEventListener: function () {} };
      }, function () { return query(d); });
    }
    return query(d);
  };
})();
"""

// Apps built with the iOS 27 SDK must use the scene lifecycle or UIKit stops them at launch
// (UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption). Info.plist's UIApplicationSceneManifest
// names this class and Main.storyboard, which loads GatewayViewController into the scene's window.
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Links that launched the app: hand them to Capacitor the same way AppDelegate does.
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}

// Paper and ink brand colours. capacitor.config.json can hold only one status bar colour, so the
// status bar strip and its text are set here from the current light/dark appearance instead.
private let paperHex = "#f3f2ef", nightHex = "#121212"
private func isDark(_ traits: UITraitCollection) -> Bool { traits.userInterfaceStyle == .dark }

@objc(GatewayViewController)
class GatewayViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        descriptor.errorPath = "error.html"
        #if DEBUG
        // Testing from a Mac: `devicectl device process launch --environment-variables '{"ONEHELM_SERVER":"https://example.com"}'`
        // points a debug build at another server. Release builds never read it.
        if let forced = validatedGatewayOrigin(ProcessInfo.processInfo.environment["ONEHELM_SERVER"]) {
            UserDefaults.standard.set(forced, forKey: gatewayServerKey)
        }
        #endif
        if let origin = validatedGatewayOrigin(UserDefaults.standard.string(forKey: gatewayServerKey)) { descriptor.serverURL = origin }
        // First frame: match the appearance at launch (the StatusBar plugin reads this on every viewDidAppear).
        let dark = isDark(UITraitCollection.current)
        var plugins = descriptor.pluginConfigurations as? [String: Any] ?? [:]
        var statusBar = plugins["StatusBar"] as? [String: Any] ?? [:]
        // iOS only: the page fills the screen and draws under the status bar. 1HC and the bundled pages use
        // viewport-fit=cover with safe-area padding, so there is no separate strip whose colour can differ from
        // the page, and the splash plugin's copy of the launch screen lines up with iOS's own (no jump down).
        statusBar["overlaysWebView"] = true
        statusBar["backgroundColor"] = dark ? nightHex : paperHex
        statusBar["style"] = dark ? "DARK" : "LIGHT"
        plugins["StatusBar"] = statusBar
        descriptor.pluginConfigurations = plugins
        descriptor.backgroundColor = brandBackground
        return descriptor
    }

    private let brandBackground = UIColor { isDark($0) ? UIColor(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255, alpha: 1)
                                                       : UIColor(red: 0xf3 / 255, green: 0xf2 / 255, blue: 0xef / 255, alpha: 1) }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(InstanceGatewayPlugin())
        webView?.configuration.userContentController.addUserScript(
            WKUserScript(source: nativePermissionShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        installErrorPageSupport()
        // The web view shrinks above the keyboard (Keyboard resize "native"); the iOS 26 keyboard's rounded,
        // translucent top edge then shows whatever is behind it, which is black unless these are coloured.
        view.backgroundColor = brandBackground
    }

    // The StatusBar plugin sizes the web view once, from the window at that moment. After a rotation (an unfolded iPhone Duo, an
    // iPad) that size went stale and left empty bands on the right and bottom. The page draws its own safe-area padding, so the web
    // view always fills the whole view.
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if let webView = webView, webView.frame != view.bounds { webView.frame = view.bounds }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        view.window?.backgroundColor = brandBackground
    }

    // Portrait on a phone-sized screen; any orientation on a screen big enough for 1HC's two columns (both sides at least
    // 500pt): an unfolded foldable like the iPhone Duo, whose big screen is wider than it is tall, or an iPad.
    private var screenIsLarge: Bool {
        let size = (view.window?.windowScene?.screen ?? UIScreen.main).bounds.size
        return min(size.width, size.height) >= 500
    }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { screenIsLarge ? .all : .portrait }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        if #available(iOS 16.0, *) { setNeedsUpdateOfSupportedInterfaceOrientations() }   // folded / unfolded: the app may now be on the other screen
        guard previous?.userInterfaceStyle != traitCollection.userInterfaceStyle else { return }
        applyStatusBarAppearance()
    }

    // Light/dark switched while the app is open: drive the StatusBar plugin's own methods so its
    // background strip and text style follow, without reloading the page.
    private func applyStatusBarAppearance() {
        guard let plugin = bridge?.plugin(withName: "StatusBar") else { return }
        let dark = isDark(traitCollection)
        for (method, options) in [("setBackgroundColor", ["color": dark ? nightHex : paperHex]),
                                  ("setStyle", ["style": dark ? "DARK" : "LIGHT"])] {
            let selector = Selector("\(method):")
            guard plugin.responds(to: selector),
                  let call = CAPPluginCall(callbackId: "native-appearance", methodName: method, options: options,
                                           success: { _, _ in }, error: { _ in }) else { continue }
            plugin.perform(selector, with: call)
        }
    }
}

// The bundled error page (apps/mobile-gateway/error.html) is shown when the selected server cannot be reached. It needs the server
// address to check the connection, and a way to load that server again or to forget it. window.Capacitor is not guaranteed on that
// page, so the address comes from a script that runs first and the two actions come through the helmNative message handler. The
// handler acts only when the message comes from the bundled error page itself, never from a page of the server.
// NOTE: written without a Mac to build on; it has not been compiled or run.
private final class ErrorPageMessages: NSObject, WKScriptMessageHandler {
    weak var controller: GatewayViewController?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let url = message.frameInfo.request.url
        guard message.frameInfo.isMainFrame, let url, url.host?.lowercased() == "localhost", url.path == "/error.html",
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        DispatchQueue.main.async { [weak self] in
            switch action {
            case "retry": self?.controller?.reloadServer()
            case "startOver":
                UserDefaults.standard.removeObject(forKey: gatewayServerKey)
                let window = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first
                window?.rootViewController = GatewayViewController(); window?.makeKeyAndVisible()
            default: break
            }
        }
    }
}

extension GatewayViewController {
    fileprivate func installErrorPageSupport() {
        guard let controller = webView?.configuration.userContentController else { return }
        let handler = ErrorPageMessages(); handler.controller = self
        controller.add(handler, name: "helmNative")
        if let origin = validatedGatewayOrigin(UserDefaults.standard.string(forKey: gatewayServerKey)),
           let data = try? JSONSerialization.data(withJSONObject: [origin], options: []), let json = String(data: data, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: "window.__helmServer = \(json)[0];", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    /// Loads the selected server again in the web view (the "Try again" action of the error page).
    fileprivate func reloadServer() {
        guard let server = bridge?.config.serverURL else { return }
        webView?.load(URLRequest(url: server))
    }
}
