<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';

import { isElectron, setAnimationClass } from '@/utils';
import { getWaveAuthStatus, waveSignIn } from '@/utils/waveAuth';

defineOptions({
  name: 'CookieLogin'
});

// Emits
interface Emits {
  (e: 'loginSuccess', userProfile: any, loginType: string): void;
  (e: 'loginError', error: string): void;
}

const emit = defineEmits<Emits>();

const { t } = useI18n();
const message = useMessage();

// Spotify 应用 Client ID（PKCE 登录无需 secret）
const token = ref('');
const loading = ref(false);

const loginByToken = async () => {
  if (!token.value.trim()) {
    const errorMsg = t('login.message.tokenRequired');
    message.error(errorMsg);
    emit('loginError', errorMsg);
    return;
  }

  try {
    loading.value = true;
    const profile = await waveSignIn('sp', token.value.trim());
    if (profile) {
      message.success(t('login.message.tokenLoginSuccess'));
      emit('loginSuccess', profile, 'cookie');
    } else {
      const errorMsg = t('login.message.tokenInvalid');
      message.error(errorMsg);
      emit('loginError', errorMsg);
    }
  } catch (error) {
    const errorMsg = t('login.message.tokenInvalid');
    message.error(errorMsg);
    emit('loginError', errorMsg);
    console.error('Spotify sign-in failed:', error);
  } finally {
    loading.value = false;
  }
};

// 打开 Spotify 开发者后台创建应用
const autoGetCookie = () => {
  message.info(t('login.message.autoGetCookieTip'));
  window.open('https://developer.spotify.com/dashboard/create', '_blank');
};

onMounted(async () => {
  const status = await getWaveAuthStatus();
  if (status?.spotifyClientId) token.value = status.spotifyClientId;
});
</script>

<template>
  <div class="cookie-login" :class="setAnimationClass('animate__fadeInUp')">
    <div class="login-title">{{ t('login.title.cookie') }}</div>
    <div class="phone-page">
      <textarea
        v-model="token"
        class="token-input"
        :placeholder="t('login.placeholder.cookie')"
        rows="4"
      />
    </div>
    <div class="text">{{ t('login.tokenTip') }}</div>
    <n-button class="btn-login" :loading="loading" @click="loginByToken()">{{
      t('login.button.cookieLogin')
    }}</n-button>
    <n-button v-if="isElectron" class="btn-auto-cookie" @click="autoGetCookie()" type="info">
      {{ t('login.button.autoGetCookie') }}
    </n-button>
  </div>
</template>

<style lang="scss" scoped>
.cookie-login {
  animation-duration: 0.5s;
  @apply flex flex-col items-center;
}

.login-title {
  @apply text-2xl font-bold mb-6 text-white;
}

.text {
  @apply mt-4 text-white text-xs;
}

.phone-page {
  @apply bg-light dark:bg-gray-800 bg-opacity-90 dark:bg-opacity-90;
  width: 250px;
  @apply rounded-2xl overflow-hidden;
  padding: 0;
  border: none;
}

.token-input {
  @apply w-full outline-none resize-none;
  @apply text-gray-900 dark:text-white bg-transparent;
  @apply placeholder-gray-500 dark:placeholder-gray-400;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.4;
  min-height: 100px;
  padding: 16px;
  margin: 0;
  border: none;
  border-radius: inherit;
  box-sizing: border-box;

  &:focus {
    @apply outline-none;
    box-shadow: none;
    border: none;
  }

  &::placeholder {
    @apply text-gray-400 dark:text-gray-500;
  }

  /* 移除浏览器默认样式 */
  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(156, 163, 175, 0.3);
    border-radius: 2px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(156, 163, 175, 0.5);
  }
}

.btn-login {
  width: 250px;
  height: 40px;
  @apply mt-10 text-white rounded-xl;
  @apply bg-green-600 hover:bg-green-700 transition-colors;
}

.btn-auto-cookie {
  width: 250px;
  height: 40px;
  @apply mt-4 text-white rounded-xl;
  @apply bg-blue-600 hover:bg-blue-700 transition-colors;
}
</style>
