import UIKit
import Photos

/*
 ImageSaver は、UIImage を iOS の「写真」ライブラリに保存するための小さなユーティリティです。
 - 主に `NukeFullWidthImage` の「画像を保存」操作（コンテキストメニュー／ロングプレス）から呼び出されます。
 - 保存前に写真ライブラリへのアクセス権限をリクエストし、許可されている場合のみ保存します。
*/
enum ImageSaver {
     /*
      保存処理の流れ:
      1. 写真ライブラリのアクセス権限をリクエスト
          - iOS 14 以降では「追加のみ (addOnly)」権限を利用可能。既存の写真への読み取りは行わず、保存に必要な最小権限で動作します。
      2. 許可状態を確認
          - iOS 14+: `authorized` または `limited` の場合にのみ保存
          - iOS 13 以前: `authorized` の場合にのみ保存
      3. 許可されていれば `UIImageWriteToSavedPhotosAlbum` で保存

      使用箇所の例:
      - `NukeFullWidthImage`: フル幅画像表示ビューのコンテキストメニュー／ロングプレス
     */
    static func saveToPhotos(_ image: UIImage) {
        if #available(iOS 14, *) {
            // iOS 14+ は「追加のみ」権限を要求できる
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                // 許可（authorized）または限定的許可（limited）のみ受理
                guard status == .authorized || status == .limited else { return }
                // 許可済みなので保存を実行
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
            }
        } else {
            // iOS 13 以前は従来の権限ダイアログ
            PHPhotoLibrary.requestAuthorization { status in
                // 許可（authorized）のみ受理
                guard status == .authorized else { return }
                // 許可済みなので保存を実行
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
            }
        }
    }
}
