import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@auth/AuthProvider'
import { AppRoutes } from '@routes/AppRoutes'
import { ConfigProvider, theme as antdTheme } from 'antd'
import { IconContext } from '@phosphor-icons/react'
import './fonts.css'
import 'antd/dist/reset.css'
import './styles.css'
import { setupPWAAssets } from '@lib/pwaAssets'

// Hoisted so the theme object keeps a stable identity across renders.
const antdThemeConfig = {
  cssVar: true,
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: 'var(--color-primary, #FFD417)',
    colorLink: 'var(--brand-blue, #2348A6)',
    colorWarning: 'var(--color-warning, #F3F78A)',
    colorInfo: 'var(--color-secondary, #C7B090)',
    colorError: 'var(--color-danger, #BE1E2D)',
    colorText: 'var(--text, #3B3B3B)',
    colorTextSecondary: 'var(--text-secondary, rgba(59,59,59,0.7))',
    colorBgBase: 'var(--bg, #F7F7F7)',
    colorBgContainer: 'var(--panel, #FFFFFF)',
    colorBgElevated: 'var(--panel, #FFFFFF)',
    colorBorder: 'var(--border, #E6E6E6)',
    fontFamily: 'var(--font-body)',
    fontSize: 15,
    fontWeightStrong: 600,
    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,
    borderRadius: 10,
    motionEaseOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
    motionEaseInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  },
  components: {
    Button: {
      colorPrimary: 'var(--color-primary, #FFD417)',
      fontWeight: 600,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
    },
    Checkbox: {
      colorWhite: '#1A1A1A',
    },
    Modal: {
      colorBgElevated: 'var(--panel)',
      colorText: 'var(--text)',
    },
    Drawer: {
      colorBgElevated: 'var(--panel)',
    },
    Dropdown: {
      colorBgElevated: 'var(--panel)',
    },
    Popover: {
      colorBgElevated: 'var(--panel)',
    },
    Tooltip: {
      colorBgElevated: 'var(--panel)',
    },
  },
}

const queryClient = new QueryClient()

// Inject icons/manifest before app mounts
setupPWAAssets()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          {/* A provider value replaces Phosphor's defaults rather than merging with them, so
              restate size/color/mirrored; without size, unsized icons stretch to their box. */}
          <IconContext.Provider
            value={{ weight: 'bold', size: '1em', color: 'currentColor', mirrored: false }}
          >
            <ConfigProvider theme={antdThemeConfig}>
              <AppRoutes />
            </ConfigProvider>
          </IconContext.Provider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
