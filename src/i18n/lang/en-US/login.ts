export default {
  title: {
    qr: 'YouTube Music',
    phone: 'Phone Login',
    cookie: 'Spotify',
    uid: 'Apple Music'
  },
  qrTip: 'Sign in with your Google account to sync YouTube Music',
  phoneTip: 'Sign in with Google, Spotify or Apple ID',
  tokenTip: 'Paste your Spotify app Client ID (redirect URI: http://127.0.0.1:8898/callback)',
  uidTip: 'Paste a MusicKit developer token, or a .p8 private key, then sign in with your Apple ID',
  placeholder: {
    phone: 'Phone Number',
    password: 'Password',
    cookie: 'Spotify Client ID',
    uid: 'MusicKit developer token or .p8 private key',
    appleTeamId: 'Apple Team ID',
    appleKeyId: 'MusicKit Key ID'
  },
  button: {
    login: 'Sign in with Apple ID',
    switchToQr: 'YouTube Music',
    switchToPhone: 'Phone Login',
    switchToToken: 'Spotify',
    switchToUid: 'Apple Music',
    backToQr: 'Back to YouTube Music',
    cookieLogin: 'Sign in with Spotify',
    autoGetCookie: 'Get a Spotify Client ID',
    refresh: 'Click to Refresh',
    refreshing: 'Refreshing...',
    refreshQr: 'Sign in again',
    googleLogin: 'Sign in with Google'
  },
  message: {
    loginSuccess: 'Signed in successfully',
    loginFailed: 'Sign-in failed',
    tokenLoginSuccess: 'Spotify connected',
    uidLoginSuccess: 'Apple Music connected',
    loadError: 'Could not open the sign-in window',
    qrCheckError: 'Error checking sign-in status',
    tokenRequired: 'Please enter your Spotify Client ID',
    tokenInvalid: 'Spotify sign-in failed, check the Client ID and redirect URI',
    uidRequired: 'Please enter a MusicKit developer token',
    uidInvalid: 'Apple ID sign-in was cancelled or the developer token is invalid',
    uidLoginFailed: 'Apple ID sign-in failed',
    phoneRequired: 'Please enter phone number',
    passwordRequired: 'Please enter password',
    phoneLoginFailed: 'Sign-in failed',
    autoGetCookieSuccess: 'Signed in successfully',
    autoGetCookieFailed: 'Sign-in failed',
    autoGetCookieTip:
      'Create an app in the Spotify dashboard, add the redirect URI, then copy its Client ID here',
    qrCheckFailed: 'Sign-in failed, please try again',
    qrLoading: 'Loading...',
    qrExpired: 'Sign-in expired, please sign in again',
    qrExpiredShort: 'Expired',
    qrExpiredWarning: 'Sign-in expired, please sign in again',
    qrScanned: 'Signed in',
    qrScannedShort: 'Connected',
    qrScannedInfo: 'Signed in',
    qrConfirmed: 'Connected, your library syncs automatically',
    qrGenerating: 'Loading...',
    googleWaiting: 'Finish signing in with Google in the new window…',
    googleLoginCancelled: 'Google sign-in was cancelled'
  },
  qrTitle: 'Sign in with Google',
  uidWarning:
    'Apple Music sign-in needs a MusicKit token from an Apple Developer account. Public Apple Music playlist links can be imported without signing in.'
};
