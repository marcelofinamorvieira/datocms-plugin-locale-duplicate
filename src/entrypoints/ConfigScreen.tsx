import { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Canvas, Button, SelectField, Form, FieldGroup, Section, Spinner } from 'datocms-react-ui';
import { useState, useEffect } from 'react';
import { buildClient } from '@datocms/cma-client-browser';

interface FieldConfig {
  modelId: string;
  fieldId: string;
}

interface ModelOption {
  label: string;
  value: string;
}

interface FieldOption {
  label: string;
  value: string;
}

export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  const [selectedModel, setSelectedModel] = useState<ModelOption | null>(null);
  const [selectedField, setSelectedField] = useState<FieldOption | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [availableFields, setAvailableFields] = useState<FieldOption[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<FieldConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Load saved configurations and models on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load saved configurations from plugin parameters
        const configs = ctx.plugin.attributes.parameters?.fieldConfigs;
        setSavedConfigs(Array.isArray(configs) ? configs : []);

        // Initialize CMA client
        const client = buildClient({
          apiToken: ctx.currentUserAccessToken || '',
          environment: ctx.environment,
        });

        // Fetch all models
        const models = await client.itemTypes.list();
        const modelOptions = models
          .filter(model => !model.modular_block)
          .map(model => ({
            label: model.name,
            value: model.id
          }));
        
        setAvailableModels(modelOptions);
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading data:', error);
        ctx.notice(`Error loading data: ${error}`);
        setIsLoading(false);
      }
    };

    loadData();
  }, [ctx]);

  // Load fields when a model is selected
  useEffect(() => {
    const loadFields = async () => {
      if (!selectedModel) {
        setAvailableFields([]);
        return;
      }

      try {
        const client = buildClient({
          apiToken: ctx.currentUserAccessToken || '',
          environment: ctx.environment,
        });

        // Fetch fields for the selected model
        const fields = await client.fields.list(selectedModel.value);
        
        // Filter only localized fields
        const fieldOptions = fields
          .filter(field => field.localized)
          .map(field => ({
            label: field.label,
            value: field.id
          }));
        
        setAvailableFields(fieldOptions);
      } catch (error) {
        console.error('Error loading fields:', error);
        ctx.notice(`Error loading fields: ${error}`);
      }
    };

    loadFields();
  }, [selectedModel, ctx]);

  const handleAddConfiguration = () => {
    if (!selectedModel || !selectedField) {
      ctx.notice('Please select both a model and a field');
      return;
    }

    // Check if this configuration already exists
    const exists = savedConfigs.some(
      config => config.modelId === selectedModel.value && config.fieldId === selectedField.value
    );

    if (exists) {
      ctx.notice('This configuration already exists');
      return;
    }

    // Add new configuration
    setSavedConfigs([...savedConfigs, {
      modelId: selectedModel.value,
      fieldId: selectedField.value
    }]);

    // Reset selections
    setSelectedModel(null);
    setSelectedField(null);
  };

  const handleRemoveConfiguration = (index: number) => {
    const newConfigs = savedConfigs.filter((_, i) => i !== index);
    setSavedConfigs(newConfigs);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await ctx.updatePluginParameters({
        ...ctx.plugin.attributes.parameters,
        fieldConfigs: savedConfigs
      });
      
      ctx.notice('Configuration saved successfully');
    } catch (error) {
      console.error('Error saving configuration:', error);
      ctx.notice(`Error saving configuration: ${error}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Get model and field names for display
  const getModelName = (modelId: string) => {
    const model = availableModels.find(m => m.value === modelId);
    return model?.label || modelId;
  };


  if (isLoading) {
    return (
      <Canvas ctx={ctx}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '200px' 
        }}>
          <Spinner />
        </div>
      </Canvas>
    );
  }

  return (
    <Canvas ctx={ctx}>
      <Form>
        <Section title="Field Copy Configuration">
          <FieldGroup>
            <p style={{ marginBottom: 'var(--spacing-m)' }}>
              Configure which fields should have copy buttons in the record editing interface. 
              Select a model and a localized field to enable the copy functionality.
            </p>

            <div style={{ display: 'flex', gap: 'var(--spacing-m)', marginBottom: 'var(--spacing-m)' }}>
              <div style={{ flex: 1 }}>
                <SelectField
                  name="model"
                  id="model"
                  label="Model"
                  hint="Select a model"
                  value={selectedModel}
                  selectInputProps={{
                    isMulti: false,
                    options: availableModels,
                  }}
                  onChange={(newValue) => {
                    setSelectedModel(newValue as ModelOption | null);
                    setSelectedField(null);
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <SelectField
                  name="field"
                  id="field"
                  label="Localized Field"
                  hint="Select a localized field"
                  value={selectedField}
                  selectInputProps={{
                    isDisabled: !selectedModel,
                    isMulti: false,
                    options: availableFields,
                  }}
                  onChange={(newValue) => {
                    setSelectedField(newValue as FieldOption | null);
                  }}
                />
              </div>
            </div>

            <Button
              buttonType="primary"
              buttonSize="s"
              onClick={handleAddConfiguration}
              disabled={!selectedModel || !selectedField}
            >
              Add Configuration
            </Button>
          </FieldGroup>
        </Section>

        <Section title="Configured Fields">
          <FieldGroup>
            {savedConfigs.length === 0 ? (
              <p style={{ 
                textAlign: 'center', 
                padding: 'var(--spacing-l)',
                color: 'var(--light-body-color)',
                backgroundColor: 'var(--light-bg-color)',
                borderRadius: 'var(--border-radius)'
              }}>
                No fields configured yet. Add a configuration above to get started.
              </p>
            ) : (
              <div style={{ marginBottom: 'var(--spacing-m)' }}>
                {savedConfigs.map((config, index) => (
                  <div 
                    key={`${config.modelId}-${config.fieldId}`}
                    style={{ 
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 'var(--spacing-s)',
                      backgroundColor: 'var(--light-bg-color)',
                      borderRadius: 'var(--border-radius)',
                      marginBottom: 'var(--spacing-xs)'
                    }}
                  >
                    <div>
                      <strong>{getModelName(config.modelId)}</strong>
                      <span style={{ margin: '0 var(--spacing-xs)' }}>→</span>
                      <span>Field ID: {config.fieldId}</span>
                    </div>
                    <Button
                      buttonType="negative"
                      buttonSize="xs"
                      onClick={() => handleRemoveConfiguration(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ 
              display: 'flex', 
              gap: 'var(--spacing-m)',
              marginTop: 'var(--spacing-l)'
            }}>
              <Button
                fullWidth
                buttonType="primary"
                buttonSize="m"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save Configuration'}
              </Button>

              <Button
                fullWidth
                buttonType="muted"
                buttonSize="m"
                onClick={() => {
                  ctx.navigateTo(`/configuration/p/${ctx.plugin.id}/pages/massLocaleDuplication`);
                }}
              >
                Go to Mass Locale Duplication
              </Button>
            </div>
          </FieldGroup>
        </Section>
      </Form>
    </Canvas>
  );
}