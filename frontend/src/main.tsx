import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { AppRoutes } from '@routes/AppRoutes'
import { ConfigProvider, theme as antdTheme } from 'antd'
import 'antd/dist/reset.css'
import './styles.css'

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ConfigProvider
            theme={{
              algorithm: antdTheme.defaultAlgorithm,
              token: {
                colorPrimary: 'var(--color-primary)',
                colorLink: 'var(--color-primary)',
                colorWarning: 'var(--color-warning)',
                colorInfo: 'var(--color-secondary)',
                colorText: 'var(--text)',
                colorTextSecondary: 'var(--text-secondary)',
                colorBgBase: 'var(--bg)',
                colorBgContainer: 'var(--panel)',
                colorBorder: 'var(--border)',
              },
            }}
          >
            <AppRoutes />
          </ConfigProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
