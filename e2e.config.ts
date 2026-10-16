import { web } from '@e2e-dev/web';

const mobile = process.env.E2E_VIEWPORT === 'mobile';
const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const configuredUrl = process.env.APP_URL;
const app = configuredUrl
  ? { url: configuredUrl }
  : {
      url: 'http://127.0.0.1:4173',
      command: {
        executable: 'node',
        args: ['tools/public-site/serve.mjs'],
        reuseExisting: true,
      },
    };

export default {
  targets: [{ engine: web({ viewport }), app }],
};
