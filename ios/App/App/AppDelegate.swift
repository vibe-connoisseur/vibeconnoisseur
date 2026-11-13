import UIKit
import Capacitor
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // Hand the phone's push token to the Capacitor push plugin.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// MARK: - Media picker
//
// Picks photos and videos for posts without iOS's slow full-quality conversion,
// then shrinks videos to 720p on the phone so uploads are much smaller and faster.
// JS: Capacitor.Plugins.MediaPicker.pick({ limit }) -> { files: [{ path, type, duration }] }


class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MediaPickerPlugin())
    }
}

@objc(MediaPickerPlugin)
public class MediaPickerPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "MediaPickerPlugin"
    public let jsName = "MediaPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    @objc func pick(_ call: CAPPluginCall) {
        let limit = max(1, call.getInt("limit") ?? 10)
        DispatchQueue.main.async {
            var config = PHPickerConfiguration()
            config.selectionLimit = limit
            config.filter = .any(of: [.images, .videos])
            config.preferredAssetRepresentationMode = .current
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            self.pendingCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pendingCall else { return }
        pendingCall = nil
        if results.isEmpty {
            call.resolve(["files": []])
            return
        }

        let total = results.count
        var files = [[String: Any]?](repeating: nil, count: total)
        var finished = 0
        let lock = NSLock()
        let group = DispatchGroup()
        notifyListeners("progress", data: ["done": 0, "total": total])

        func store(_ index: Int, _ file: [String: Any]?) {
            lock.lock()
            files[index] = file
            finished += 1
            let done = finished
            lock.unlock()
            notifyListeners("progress", data: ["done": done, "total": total])
            group.leave()
        }

        for (index, result) in results.enumerated() {
            group.enter()
            let provider = result.itemProvider
            if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                    // The picker deletes its copy when this returns, so keep our own.
                    guard let url = url else { return store(index, nil) }
                    let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
                    let source = FileManager.default.temporaryDirectory
                        .appendingPathComponent("wtv-src-\(UUID().uuidString)").appendingPathExtension(ext)
                    do { try FileManager.default.copyItem(at: url, to: source) } catch { return store(index, nil) }
                    self.shrinkVideo(source) { output, duration in
                        if let output = output {
                            try? FileManager.default.removeItem(at: source)
                            store(index, ["path": output.path, "type": "video", "duration": duration, "mime": "video/mp4"])
                        } else {
                            // Couldn't shrink it: send the original instead.
                            store(index, ["path": source.path, "type": "video", "duration": duration,
                                          "mime": ext.lowercased() == "mp4" ? "video/mp4" : "video/quicktime"])
                        }
                    }
                }
            } else if provider.canLoadObject(ofClass: UIImage.self) {
                provider.loadObject(ofClass: UIImage.self) { object, _ in
                    guard let image = object as? UIImage, let data = self.jpeg(image, maxSize: 2000) else { return store(index, nil) }
                    let output = FileManager.default.temporaryDirectory
                        .appendingPathComponent("wtv-\(UUID().uuidString).jpg")
                    do { try data.write(to: output) } catch { return store(index, nil) }
                    store(index, ["path": output.path, "type": "image", "mime": "image/jpeg"])
                }
            } else {
                store(index, nil)
            }
        }

        group.notify(queue: .main) {
            call.resolve(["files": files.compactMap { $0 }])
        }
    }

    // Re-encodes to 720p H.264 MP4, which plays everywhere and is a fraction of the size.
    private func shrinkVideo(_ source: URL, completion: @escaping (URL?, Double) -> Void) {
        let asset = AVURLAsset(url: source)
        let duration = CMTimeGetSeconds(asset.duration)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
            return completion(nil, duration)
        }
        let output = FileManager.default.temporaryDirectory.appendingPathComponent("wtv-\(UUID().uuidString).mp4")
        export.outputURL = output
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.exportAsynchronously {
            completion(export.status == .completed ? output : nil, duration)
        }
    }

    private func jpeg(_ image: UIImage, maxSize: CGFloat) -> Data? {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxSize ? maxSize / longest : 1
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        return resized.jpegData(compressionQuality: 0.85)
    }
}
