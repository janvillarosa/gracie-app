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
              cssVar: true,
              algorithm: antdTheme.defaultAlgorithm,
              token: {
                colorPrimary: 'var(--color-primary, #A094F2)',
                colorLink: 'var(--color-primary, #A094F2)',
                colorWarning: 'var(--color-warning)',
                colorInfo: 'var(--color-secondary)',
                colorText: 'var(--text)',
                colorTextSecondary: 'var(--text-secondary)',
                colorBgBase: 'var(--bg)',
                colorBgContainer: 'var(--panel)',
                colorBgElevated: 'var(--panel)',
                colorBorder: 'var(--border)',
              },
              components: {
                Button: {
                  colorPrimary: '#A094F2',
                },
                Modal: {
                  colorBgElevated: 'var(--panel)',
                  colorText: 'var(--text)'
                },
                Drawer: {
                  colorBgElevated: 'var(--panel)'
                },
                Dropdown: {
                  colorBgElevated: 'var(--panel)'
                },
                Popover: {
                  colorBgElevated: 'var(--panel)'
                },
                Tooltip: {
                  colorBgElevated: 'var(--panel)'
                },
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
