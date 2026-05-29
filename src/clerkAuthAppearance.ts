/** Clerk 预置组件：白底卡片 + 深色文字（外层页面仍为紫黑氛围） */
export const clerkAuthAppearance = {
  layout: {
    /** 隐藏各组件底部「Development mode」等开发态提示（生产环境无此项） */
    unsafe_disableDevelopmentModeWarnings: true,
  },
  variables: {
    colorPrimary: '#7c3aed',
    colorDanger: '#e11d48',
    colorSuccess: '#059669',
    colorWarning: '#d97706',
    colorBackground: '#ffffff',
    colorInputBackground: '#f8fafc',
    colorInputText: '#0f172a',
    colorText: '#0f172a',
    colorTextSecondary: '#64748b',
    colorNeutral: '#94a3b8',
    borderRadius: '14px',
    fontFamily: '"DM Sans", system-ui, sans-serif',
    fontFamilyButtons: '"Syne", system-ui, sans-serif',
  },
  elements: {
    rootBox: {
      width: '100%',
      maxWidth: '100%',
      backgroundColor: 'transparent',
      marginLeft: 'auto',
      marginRight: 'auto',
    },
    /* 白卡 + 底栏同属一层圆角容器，避免白卡底圆角与灰条错位露出两侧背景 */
    cardBox: {
      borderRadius: '14px',
      overflow: 'hidden',
      boxShadow:
        '0 0 0 1px rgba(15, 23, 42, 0.06), 0 20px 50px rgba(0, 0, 0, 0.18)',
    },
    card: {
      width: '100%',
      maxWidth: '100%',
      backgroundColor: '#ffffff',
      backgroundImage: 'none',
      border: 'none',
      borderRadius: '0',
      boxShadow: 'none',
    },
    headerTitle: {
      fontFamily: '"Syne", system-ui, sans-serif',
      color: '#0f172a',
      letterSpacing: '-0.02em',
    },
    headerSubtitle: {
      color: '#64748b',
    },
    socialButtonsBlockButton: {
      borderColor: '#e2e8f0',
      color: '#334155',
    },
    socialButtonsBlockButtonText: {
      color: '#334155',
    },
    dividerLine: {
      background: '#e2e8f0',
      backgroundColor: '#e2e8f0',
    },
    formFieldLabel: {
      color: '#475569',
    },
    formFieldHintText: {
      color: '#64748b',
    },
    formFieldInput: {
      color: '#0f172a',
    },
    formFieldInputShowPasswordButton: {
      color: '#64748b',
    },
    formButtonPrimary: {
      fontWeight: 600,
      color: '#ffffff',
      backgroundColor: '#7c3aed',
      backgroundImage: 'none',
      boxShadow: 'none',
    },
    footer: {
      color: '#64748b',
      backgroundColor: '#f1f5f9',
    },
    footerActionLink: {
      color: '#7c3aed',
    },
    alternativeMethodsBlockButton: {
      borderColor: '#e2e8f0',
      color: '#334155',
    },
    identityPreviewText: {
      color: '#0f172a',
    },
    identityPreviewEditButton: {
      color: '#7c3aed',
    },
  },
  /** 右上角 UserButton 弹层：去掉底部 Clerk 标、加深菜单字色 */
  userButton: {
    variables: {
      colorText: '#0f172a',
      colorTextSecondary: '#475569',
    },
    elements: {
      userButtonPopoverFooter: {
        display: 'none',
      },
      userButtonPopoverActionButton: {
        color: '#0f172a',
        fontWeight: 500,
      },
      userButtonPopoverActionButtonIcon: {
        color: '#475569',
      },
    },
  },
}
