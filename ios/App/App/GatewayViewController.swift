import UIKit
import Capacitor
import WebKit

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
        CAPPluginMethod(name: "clearServer", returnType: CAPPluginReturnPromise)
    ]

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
        return NSNumber(value: !(exactSelected || exactLocal))
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

@objc(GatewayViewController)
class GatewayViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        descriptor.errorPath = "error.html"
        if let origin = validatedGatewayOrigin(UserDefaults.standard.string(forKey: gatewayServerKey)) { descriptor.serverURL = origin }
        return descriptor
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(InstanceGatewayPlugin())
    }
}
