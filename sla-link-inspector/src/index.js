import ForgeUI, { render, IssuePanel, Text, Fragment, useProductContext, useState } from '@forge/ui';
import api from '@forge/api';

const App = () => {
  const context = useProductContext();
  const issueKey = context.platformContext.issueKey;

  const [linkedIssues] = useState(async () => {
    // Fetch current issue data
    const response = await api.asApp().requestJira(`/rest/api/3/issue/${issueKey}`);
    const issue = await response.json();

    // Extract outward linked issues (simplified)
    const links = issue.fields.issuelinks || [];
    const linkedKeys = links
      .filter(link => link.outwardIssue)
      .map(link => link.outwardIssue.key);

    return linkedKeys;
  });

  return (
    <IssuePanel>
      <Fragment>
        <Text>🔗 Linked Tickets:</Text>
        {linkedIssues.length === 0 ? (
          <Text>No linked issues found.</Text>
        ) : (
          linkedIssues.map((key, index) => (
            <Text key={index}>• {key}</Text>
          ))
        )}
      </Fragment>
    </IssuePanel>
  );
};

export const run = render(<App />);

