import React from 'react'
import { Card, Typography } from 'antd'
import { BrandLogo } from '@components/BrandLogo'

type Props = {
  title: string
  // Where the logo links; the current auth page, so it never leaves the flow.
  logoTo: string
  footer: React.ReactNode
  children: React.ReactNode
}

// Shared frame for login and register: brand lockup, a paper card, and a footer link
// separated from the form by a hairline.
export const AuthShell: React.FC<Props> = ({ title, logoTo, footer, children }) => (
  <div className="login-page">
    <div className="container auth-container">
      <div className="brand-banner">
        <div className="brand-row">
          <BrandLogo to={logoTo} size={72} />
          <span className="brand-wordmark">Bauhouse</span>
        </div>
      </div>
      <Card className="paper-card auth-card">
        <Typography.Title level={2} className="auth-title">
          {title}
        </Typography.Title>
        {children}
        <div className="auth-footer">{footer}</div>
      </Card>
    </div>
  </div>
)
