import ForgeUI, { render, IssuePanel, Text } from '@forge/ui';

const App = () => {
  return (
    <IssuePanel>
      <Text>SLA Link Inspector Panel Loaded.</Text>
    </IssuePanel>
  );
};

export const renderApp = render(<App />);
