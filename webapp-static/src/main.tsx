import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Amplify } from 'aws-amplify';
// Required for OAuth callback handling in production builds
// MUST be imported BEFORE Amplify.configure() - the listener is notified during configure()
// See: https://github.com/aws-amplify/amplify-js/issues/13688
// eslint-disable-next-line import/no-unresolved
import 'aws-amplify/auth/enable-oauth-listener';
import { config } from './config';
import App from './App';
import './index.css';

// Configure Amplify - this triggers the OAuth listener if code/state are in URL
Amplify.configure(config);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
