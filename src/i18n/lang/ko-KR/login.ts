export default {
  title: {
    qr: 'YouTube Music',
    phone: '전화번호 로그인',
    cookie: 'Spotify'
  },
  qrTip: 'Google 계정으로 로그인하여 YouTube Music 동기화',
  phoneTip: 'Google 또는 Spotify로 로그인',
  tokenTip: 'Spotify 앱 Client ID를 붙여넣으세요 (리디렉션 URI: http://127.0.0.1:8898/callback)',
  placeholder: {
    phone: '전화번호',
    password: '비밀번호',
    cookie: 'Spotify Client ID'
  },
  button: {
    login: '로그인',
    switchToQr: 'YouTube Music',
    switchToPhone: '전화번호 로그인',
    switchToToken: 'Spotify',
    backToQr: 'YouTube Music으로 돌아가기',
    cookieLogin: 'Spotify로 로그인',
    autoGetCookie: 'Spotify Client ID 받기',
    refresh: '클릭하여 새로고침',
    refreshing: '새로고침 중...',
    refreshQr: '다시 로그인',
    googleLogin: 'Google로 로그인'
  },
  message: {
    loginSuccess: '로그인 성공',
    loginFailed: '로그인 실패',
    tokenLoginSuccess: 'Spotify 연결됨',
    loadError: '로그인 창을 열 수 없습니다',
    qrCheckError: '로그인 상태 확인 오류',
    tokenRequired: 'Spotify Client ID를 입력하세요',
    tokenInvalid: 'Spotify 로그인 실패, Client ID와 리디렉션 URI를 확인하세요',
    phoneRequired: '전화번호를 입력하세요',
    passwordRequired: '비밀번호를 입력하세요',
    phoneLoginFailed: '로그인 실패',
    autoGetCookieSuccess: '로그인 성공',
    autoGetCookieFailed: '로그인 실패',
    autoGetCookieTip:
      'Spotify 대시보드에서 앱을 만들고 리디렉션 URI를 추가한 뒤 Client ID를 여기에 복사하세요',
    qrCheckFailed: '로그인 실패, 다시 시도하세요',
    qrLoading: '로딩 중...',
    qrExpired: '로그인이 만료되었습니다',
    qrExpiredShort: '만료됨',
    qrExpiredWarning: '로그인이 만료되었습니다',
    qrScanned: '로그인됨',
    qrScannedShort: '연결됨',
    qrScannedInfo: '로그인됨',
    qrConfirmed: '연결되었습니다. 라이브러리가 자동으로 동기화됩니다',
    qrGenerating: '로딩 중...',
    googleWaiting: '새 창에서 Google 로그인을 완료하세요…',
    googleLoginCancelled: 'Google 로그인이 취소되었습니다'
  },
  qrTitle: 'Google로 로그인'
};
