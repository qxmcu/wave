<template>
  <div class="uid-login">
    <div class="login-title">{{ t('login.title.uid') }}</div>
    <div class="uid-page">
      <input
        v-model="uid"
        class="uid-input"
        type="text"
        :placeholder="t('login.placeholder.uid')"
        @keyup.enter="handleLogin"
      />
      <input
        v-if="showKeyFields"
        v-model="teamId"
        class="uid-input"
        type="text"
        :placeholder="t('login.placeholder.appleTeamId')"
      />
      <input
        v-if="showKeyFields"
        v-model="keyId"
        class="uid-input"
        type="text"
        :placeholder="t('login.placeholder.appleKeyId')"
      />
    </div>
    <div class="text">{{ t('login.uidTip') }}</div>
    <div class="warning-text">
      {{ t('login.uidWarning') }}
    </div>
    <n-button class="btn-login" :loading="loading" @click="handleLogin">
      {{ t('login.button.login') }}
    </n-button>
  </div>
</template>

<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { useI18n } from 'vue-i18n';

import { getWaveAuthStatus, waveSignIn } from '@/utils/waveAuth';

defineOptions({
  name: 'UidLogin'
});

// Props
interface Props {
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false
});

// Emits
interface Emits {
  (e: 'loginSuccess', userProfile: any, loginType: string): void;
  (e: 'loginError', error: string): void;
}

const emit = defineEmits<Emits>();

const { t } = useI18n();
const message = useMessage();

// 状态：MusicKit 开发者令牌，或 .p8 私钥 + Team ID + Key ID
const uid = ref('');
const teamId = ref('');
const keyId = ref('');
const loading = ref(false);
const configured = ref(false);
const showKeyFields = computed(() => uid.value.includes('BEGIN PRIVATE KEY'));

onMounted(async () => {
  const status = await getWaveAuthStatus();
  configured.value = Boolean(status?.appleConfigured);
});

// Apple ID 登录处理
const handleLogin = async () => {
  if (props.disabled || loading.value) return;

  const value = uid.value.trim();
  if (!value && !configured.value) {
    const errorMsg = t('login.message.uidRequired');
    message.error(errorMsg);
    emit('loginError', errorMsg);
    return;
  }

  try {
    loading.value = true;
    const creds = !value
      ? undefined
      : showKeyFields.value
        ? { privateKey: value, teamId: teamId.value.trim(), keyId: keyId.value.trim() }
        : { developerToken: value };
    const profile = await waveSignIn('am', creds);

    if (profile) {
      message.success(t('login.message.uidLoginSuccess'));
      emit('loginSuccess', profile, 'cookie');
    } else {
      const errorMsg = t('login.message.uidInvalid');
      message.error(errorMsg);
      emit('loginError', errorMsg);
    }
  } catch (error: any) {
    console.error('Apple ID sign-in failed:', error);
    const errorMsg = t('login.message.uidLoginFailed');
    message.error(errorMsg);
    emit('loginError', errorMsg);
  } finally {
    loading.value = false;
  }
};

// 重置表单
const reset = () => {
  uid.value = '';
  teamId.value = '';
  keyId.value = '';
  loading.value = false;
};

// 暴露方法给父组件
defineExpose({
  reset
});
</script>

<style lang="scss" scoped>
.uid-login {
  animation-duration: 0.5s;
  width: 250px;

  .login-title {
    @apply text-2xl font-bold mb-6 text-white;
  }

  .text {
    @apply mt-4 text-white text-xs;
  }

  .warning-text {
    @apply mt-2 text-orange-400 text-xs text-center max-w-xs;
    line-height: 1.4;
  }

  .uid-page {
    @apply bg-light dark:bg-gray-800 bg-opacity-90 dark:bg-opacity-90;
    @apply rounded-2xl overflow-hidden;
  }

  .uid-input {
    height: 40px;
    @apply w-full px-4 outline-none;
    @apply text-gray-900 dark:text-white bg-transparent;
    @apply border-b border-gray-200 dark:border-gray-700;
    @apply placeholder-gray-500 dark:placeholder-gray-400;

    &:focus {
      @apply border-green-500;
    }
  }

  .btn-login {
    width: 250px;
    height: 40px;
    @apply mt-10 text-white rounded-xl;
    @apply bg-green-600 hover:bg-green-700 transition-colors;
  }
}
</style>
