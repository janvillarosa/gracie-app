import React from 'react'
import { Paper, PaperStack } from '@components/ui'
import { Typography } from 'antd'
import { BrandLogo } from '@components/BrandLogo'

type Props = {
  title: string
  // Where the logo links: the landing page, so a visitor who isn't ready to sign in or up can
  // go back to what Bauhouse is.
  logoTo?: string
  footer: React.ReactNode
  children: React.ReactNode
}

// Shared frame for login and register: brand lockup, a paper card, and a footer link
// separated from the form by a hairline.
export const AuthShell: React.FC<Props> = ({ title, logoTo = '/', footer, children }) => (
  <div className="login-page">
    <div className="container auth-container">
      <div className="brand-banner">
        <div className="brand-row">
          <BrandLogo to={logoTo} size={72} linkLabel="Bauhouse home" />
          <span className="brand-wordmark">Bauhouse</span>
        </div>
      </div>
      <PaperStack>
        <Paper className="auth-card">
          <Typography.Title level={2} className="auth-title">
            {title}
          </Typography.Title>
          {children}
          <div className="auth-footer">{footer}</div>
        </Paper>
      </PaperStack>
    </div>
  </div>
)
