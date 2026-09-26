import type { Preview } from '@storybook/react';
import '../src/tokens/index.css';
import '../src/app.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'page',
      values: [
        { name: 'page', value: '#FFFFFF' },
        { name: 'subtle', value: '#F7F9FB' },
        { name: 'band', value: '#EEF4FB' },
        { name: 'dark', value: '#00265D' },
      ],
    },
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
    controls: { expanded: true },
  },
};

export default preview;
