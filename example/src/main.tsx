import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@meshagent/meshagent-tailwind/dist/index.css';
import './index.css'

import App from './App.tsx'

const root = document.getElementById('root');

if (!root) {
    throw new Error('Root element not found');
}

createRoot(root!)
    .render(<StrictMode><App /></StrictMode>);

