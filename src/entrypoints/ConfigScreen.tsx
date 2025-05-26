import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Button } from 'datocms-react-ui';

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  return (
    <Canvas ctx={ctx}>
      <div style={{ padding: 'var(--spacing-m)' }}>
        <h2>Field Copy Configuration</h2>
        <p>Configure which fields should have copy buttons in the record editing interface.</p>
        <p>This feature is coming soon...</p>
        
        <div style={{ marginTop: 'var(--spacing-xl)' }}>
          <Button
            buttonType="primary"
            buttonSize="m"
            onClick={() => {
              ctx.navigateTo(`/configuration/p/${ctx.plugin.id}/pages/massLocaleDuplication`);
            }}
          >
            Go to Mass Locale Duplication
          </Button>
        </div>
      </div>
    </Canvas>
  );
}