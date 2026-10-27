<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

import { setAnimationClass } from '@/utils';
import { getWaveAuthStatus, waveSignIn } from '@/utils/waveAuth';

defineOptions({
  name: 'QrLogin'
});

// Emits
interface Emits {
  (e: 'loginSuccess', userProfile: any, loginType: string): void;
  (e: 'loginError', error: string): void;
}

const emit = defineEmits<Emits>();

const { t } = useI18n();
const message = useMessage();

// Google 账号登录（YouTube Music）
const qrStatus = ref<'active' | 'loading' | 'confirmed'>('active');

const signInWithGoogle = async () => {
  try {
    qrStatus.value = 'loading';
    const profile = await waveSignIn('yt');
    if (!profile) {
      qrStatus.value = 'active';
      const errorMsg = t('login.message.googleLoginCancelled');
      message.warning(errorMsg);
      emit('loginError', errorMsg);
      return;
    }
    qrStatus.value = 'confirmed';
    message.success(t('login.message.loginSuccess'));
    emit('loginSuccess', profile, 'cookie');
  } catch (error) {
    qrStatus.value = 'active';
    const errorMsg = t('login.message.loadError');
    message.error(errorMsg);
    emit('loginError', errorMsg);
    console.error('Google sign-in failed:', error);
  }
};

const getStatusText = () => {
  switch (qrStatus.value) {
    case 'loading':
      return t('login.message.googleWaiting');
    case 'confirmed':
      return t('login.message.qrConfirmed');
    default:
      return t('login.qrTip');
  }
};

// 已登录 Google 时自动同步，无需再次登录
onMounted(async () => {
  const status = await getWaveAuthStatus();
  if (status?.signedIn.yt) {
    qrStatus.value = 'confirmed';
  }
});
</script>

<template>
  <div class="qr-login" :class="setAnimationClass('animate__fadeInUp')">
    <div class="login-title">{{ t('login.title.qr') }}</div>

    <div class="qr-container">
      <div v-if="qrStatus === 'loading'" class="qr-loading">
        <n-spin size="large" />
        <div class="loading-text">{{ t('login.message.googleWaiting') }}</div>
      </div>

      <div v-else class="qr-image-wrapper">
        <div class="qr-img qr-logo" @click="signInWithGoogle">
          <i class="ri-youtube-fill"></i>
        </div>

        <div v-if="qrStatus === 'confirmed'" class="scanned-overlay">
          <div class="scanned-icon">✓</div>
          <div class="scanned-text">{{ t('login.message.qrScannedShort') }}</div>
        </div>
      </div>
    </div>

    <div class="text" :class="{ scanned: qrStatus === 'confirmed' }">
      {{ getStatusText() }}
    </div>

    <div class="refresh-area">
      <n-button class="btn-login" :loading="qrStatus === 'loading'" @click="signInWithGoogle">
        <i class="ri-google-fill mr-2"></i>{{ t('login.button.googleLogin') }}
      </n-button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.qr-login {
  animation-duration: 0.5s;
}

.login-title {
  @apply text-2xl font-bold mb-6 text-white;
}

.qr-container {
  @apply relative;
  width: 200px;
  height: 200px;
  @apply mx-auto;
}

.qr-loading {
  @apply flex flex-col items-center justify-center h-full;

  .loading-text {
    @apply mt-4 text-white text-sm;
  }
}

.qr-image-wrapper {
  @apply relative w-full h-full;

  &.expired {
    .qr-img {
      @apply opacity-30;
    }
  }
}

.qr-img {
  @apply w-full h-full rounded-2xl transition-all duration-300;
  object-fit: cover;
}

.expired-overlay {
  @apply absolute inset-0 flex flex-col items-center justify-center;
  @apply bg-black bg-opacity-50 rounded-2xl;

  .expired-text {
    @apply text-white text-sm mb-3;
  }

  .refresh-btn {
    @apply text-sm;
  }
}

.scanned-overlay {
  @apply absolute inset-0 flex flex-col items-center justify-center;
  @apply bg-green-500 bg-opacity-80 rounded-2xl;

  .scanned-icon {
    @apply text-white text-4xl font-bold mb-2;
  }

  .scanned-text {
    @apply text-white text-sm;
  }
}

.text {
  @apply mt-4 text-white text-xs transition-colors duration-300;

  &.expired {
    @apply text-orange-400;
  }

  &.scanned {
    @apply text-green-400;
  }
}

.qr-logo {
  @apply flex items-center justify-center bg-white cursor-pointer;
  font-size: 96px;
  color: #ff0000;
}

.btn-login {
  width: 250px;
  height: 40px;
  @apply text-white rounded-xl;
  @apply bg-green-600 hover:bg-green-700 transition-colors;
}

.refresh-area {
  @apply mt-3;

  .manual-refresh {
    @apply text-gray-300 hover:text-white text-xs;
  }
}
</style>
