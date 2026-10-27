export default {
  title: {
    qr: 'YouTube Music',
    phone: '電話番号ログイン',
    cookie: 'Spotify',
    uid: 'Apple Music'
  },
  qrTip: 'Google アカウントでログインして YouTube Music を同期',
  phoneTip: 'Google、Spotify、Apple ID でログイン',
  tokenTip:
    'Spotify アプリの Client ID を貼り付け（リダイレクト URI：http://127.0.0.1:8898/callback）',
  uidTip: 'MusicKit デベロッパートークンまたは .p8 秘密鍵を貼り付けて Apple ID でサインイン',
  placeholder: {
    phone: '電話番号',
    password: 'パスワード',
    cookie: 'Spotify Client ID',
    uid: 'MusicKit デベロッパートークンまたは .p8 秘密鍵',
    appleTeamId: 'Apple Team ID',
    appleKeyId: 'MusicKit Key ID'
  },
  button: {
    login: 'Apple ID でサインイン',
    switchToQr: 'YouTube Music',
    switchToPhone: '電話番号ログイン',
    switchToToken: 'Spotify',
    switchToUid: 'Apple Music',
    backToQr: 'YouTube Music に戻る',
    cookieLogin: 'Spotify でログイン',
    autoGetCookie: 'Spotify Client ID を取得',
    refresh: 'クリックして更新',
    refreshing: '更新中...',
    refreshQr: '再ログイン',
    googleLogin: 'Google でログイン'
  },
  message: {
    loginSuccess: 'ログインしました',
    loginFailed: 'ログインに失敗しました',
    tokenLoginSuccess: 'Spotify に接続しました',
    uidLoginSuccess: 'Apple Music に接続しました',
    loadError: 'ログインウィンドウを開けません',
    qrCheckError: 'ログイン状態の確認でエラー',
    tokenRequired: 'Spotify Client ID を入力してください',
    tokenInvalid: 'Spotify ログインに失敗しました。Client ID とリダイレクト URI を確認してください',
    uidRequired: 'MusicKit デベロッパートークンを入力してください',
    uidInvalid: 'Apple ID サインインがキャンセルされたか、トークンが無効です',
    uidLoginFailed: 'Apple ID サインインに失敗しました',
    phoneRequired: '電話番号を入力してください',
    passwordRequired: 'パスワードを入力してください',
    phoneLoginFailed: 'ログインに失敗しました',
    autoGetCookieSuccess: 'ログインしました',
    autoGetCookieFailed: 'ログインに失敗しました',
    autoGetCookieTip:
      'Spotify ダッシュボードでアプリを作成しリダイレクト URI を追加して、Client ID をここにコピーしてください',
    qrCheckFailed: 'ログインに失敗しました。再試行してください',
    qrLoading: '読み込み中...',
    qrExpired: 'ログインの有効期限が切れました',
    qrExpiredShort: '期限切れ',
    qrExpiredWarning: 'ログインの有効期限が切れました',
    qrScanned: 'ログイン済み',
    qrScannedShort: '接続済み',
    qrScannedInfo: 'ログイン済み',
    qrConfirmed: '接続しました。ライブラリは自動で同期されます',
    qrGenerating: '読み込み中...',
    googleWaiting: '新しいウィンドウで Google ログインを完了してください…',
    googleLoginCancelled: 'Google ログインはキャンセルされました'
  },
  qrTitle: 'Google でログイン',
  uidWarning:
    'Apple Music のサインインには Apple Developer アカウントの MusicKit トークンが必要です。公開プレイリストのリンクはサインインなしでインポートできます。'
};
