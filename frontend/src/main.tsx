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
                colorWarning: 'var(--color-warning, #F3F78A)',
                colorInfo: 'var(--color-secondary, #C7B090)',
                colorText: 'var(--text, #3B3B3B)',
                colorTextSecondary: 'var(--text-secondary, rgba(59,59,59,0.7))',
                colorBgBase: 'var(--bg, #F7F7F7)',
                colorBgContainer: 'var(--panel, #FFFFFF)',
                colorBgElevated: 'var(--panel, #FFFFFF)',
                colorBorder: 'var(--border, #E6E6E6)',
              },
              components: {
                Button: {
                  colorPrimary: 'var(--color-primary-deep, #7D6EF0)',
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
