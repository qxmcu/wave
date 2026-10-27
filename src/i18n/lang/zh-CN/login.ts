export default {
  title: {
    qr: 'YouTube Music',
    phone: '手机号登录',
    cookie: 'Spotify'
  },
  qrTip: '使用 Google 账号登录以同步 YouTube Music',
  phoneTip: '使用 Google 或 Spotify 登录',
  tokenTip: '粘贴你的 Spotify 应用 Client ID（回调地址：http://127.0.0.1:8898/callback）',
  placeholder: {
    phone: '手机号',
    password: '密码',
    cookie: 'Spotify Client ID'
  },
  button: {
    login: '登录',
    switchToQr: 'YouTube Music',
    switchToPhone: '手机号登录',
    switchToToken: 'Spotify',
    backToQr: '返回 YouTube Music',
    cookieLogin: '使用 Spotify 登录',
    autoGetCookie: '获取 Spotify Client ID',
    refresh: '点击刷新',
    refreshing: '刷新中...',
    refreshQr: '重新登录',
    googleLogin: '使用 Google 登录'
  },
  message: {
    loginSuccess: '登录成功',
    loginFailed: '登录失败',
    tokenLoginSuccess: '已连接 Spotify',
    loadError: '无法打开登录窗口',
    qrCheckError: '检查登录状态出错',
    tokenRequired: '请输入 Spotify Client ID',
    tokenInvalid: 'Spotify 登录失败，请检查 Client ID 和回调地址',
    phoneRequired: '请输入手机号',
    passwordRequired: '请输入密码',
    phoneLoginFailed: '登录失败',
    autoGetCookieSuccess: '登录成功',
    autoGetCookieFailed: '登录失败',
    autoGetCookieTip: '在 Spotify 开发者后台创建应用并添加回调地址，然后复制 Client ID 到这里',
    qrCheckFailed: '登录失败，请重试',
    qrLoading: '加载中...',
    qrExpired: '登录已过期，请重新登录',
    qrExpiredShort: '已过期',
    qrExpiredWarning: '登录已过期，请重新登录',
    qrScanned: '已登录',
    qrScannedShort: '已连接',
    qrScannedInfo: '已登录',
    qrConfirmed: '已连接，资料库会自动同步',
    qrGenerating: '加载中...',
    googleWaiting: '请在新窗口中完成 Google 登录…',
    googleLoginCancelled: '已取消 Google 登录'
  },
  qrTitle: '使用 Google 登录'
};
