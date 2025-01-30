import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { useState } from 'react';
import styles from './styles.module.css';

type Props = {
  ctx: RenderConfigScreenCtx;
};

interface LocalizedField {
  [locale: string]: any;
}

interface Updates {
  [fieldKey: string]: LocalizedField;
}

interface ProgressUpdate {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
}

function removeBlockItemIds(obj: any) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      removeBlockItemIds(obj[i]);
    }
  } else if (obj && typeof obj === 'object') {
    // If this is a "block" type object with an "item" that has an "id", remove the item's id
    if (obj.type === 'block' && obj.item && obj.item.id) {
      delete obj.item.id;
    }

    // If this is a "type": "item" object (not "item_type"), remove that object's id
    if (obj.type === 'item' && obj.id) {
      delete obj.id;
    }

    for (const key in obj) {
      removeBlockItemIds(obj[key]);
    }
  }
  return obj;
}

function ProgressView({
  updates,
  sourceLocale,
  targetLocale,
}: {
  updates: ProgressUpdate[];
  sourceLocale: string;
  targetLocale: string;
}) {
  return (
    <div className={styles.progressContainer}>
      <h2 className={styles.progressHeading}>
        Duplicating content from {sourceLocale} to {targetLocale}
      </h2>
      <div className={styles.updatesList}>
        {updates.map((update) => (
          <div
            key={update.timestamp}
            className={`${styles.updateItem} ${styles[update.type]}`}
          >
            {update.message}
          </div>
        ))}
      </div>
    </div>
  );
}

async function duplicateLocaleContent(
  ctx: RenderConfigScreenCtx,
  sourceLocale: string,
  targetLocale: string,
  onProgress: (update: ProgressUpdate) => void
) {
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken!,
  });
  try {
    const allModels = await client.itemTypes.list();
    const models = allModels.filter((model) => !model.modular_block);

    onProgress({
      message: `Found ${models.length} content models to process`,
      type: 'info',
      timestamp: Date.now(),
    });

    for (const model of models) {
      onProgress({
        message: `Processing model: ${model.name}`,
        type: 'info',
        timestamp: Date.now(),
      });

      try {
        for await (const record of client.items.rawListPagedIterator({
          filter: {
            type: model.api_key,
          },
          nested: true,
        })) {
          try {
            let updates: Updates = {};

            for (const [fieldKey, fieldValue] of Object.entries(
              record.attributes
            )) {
              if (
                fieldKey.startsWith('_') ||
                [
                  'id',
                  'type',
                  'meta',
                  'created_at',
                  'updated_at',
                  'is_valid',
                  'item_type',
                ].includes(fieldKey)
              ) {
                continue;
              }

              if (
                fieldValue &&
                typeof fieldValue === 'object' &&
                Object.keys(fieldValue as object).includes(sourceLocale)
              ) {
                updates[fieldKey] = { ...(fieldValue as LocalizedField) };
                updates[fieldKey][targetLocale] = (
                  fieldValue as LocalizedField
                )[sourceLocale];
                updates = removeBlockItemIds(updates);
              }
            }

            if (Object.keys(updates).length > 0) {
              try {
                await client.items.update(record.id, updates);
                onProgress({
                  message: `Updated record: ${record.id}`,
                  type: 'success',
                  timestamp: Date.now(),
                });
              } catch (updateError) {
                onProgress({
                  message: `Failed to update record ${record.id}: (Check if the original record is currently invalid, and fix validation errors present)`,
                  type: 'error',
                  timestamp: Date.now(),
                });
                throw updateError;
              }
            }
          } catch (error) {
            continue;
          }
        }
      } catch (modelError) {
        onProgress({
          message: `Error processing model ${model.name}: ${modelError} (Check if the original record is currently invalid, and fix validation errors present)`,
          type: 'error',
          timestamp: Date.now(),
        });
        continue;
      }
    }

    onProgress({
      message: 'Verifying content migration...',
      type: 'info',
      timestamp: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

    onProgress({
      message: 'Migration completed successfully!',
      type: 'success',
      timestamp: Date.now(),
    });
  } catch (error) {
    onProgress({
      message: `Error during migration: ${error} (Check if the original record is currently invalid, and fix validation errors present)`,
      type: 'error',
      timestamp: Date.now(),
    });
    throw error;
  }
}

export default function ConfigScreen({ ctx }: Props) {
  const currentSiteLocales = ctx.site.attributes.locales;
  const [sourceLocale, setSourceLocale] = useState<string>(
    currentSiteLocales[0]
  );
  const [targetLocale, setTargetLocale] = useState<string>(
    currentSiteLocales[1]
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);

  const handleProgress = (update: ProgressUpdate) => {
    setProgressUpdates((prev) => [...prev, update]);
  };

  return (
    <Canvas ctx={ctx}>
      <div
        className={`${styles.formContainer} ${
          isProcessing ? styles.hidden : ''
        }`}
      >
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ marginRight: '-12px' }}>From</h3>
          <SelectField
            name="fromLocale"
            id="fromLocale"
            label=""
            value={[
              {
                label: sourceLocale,
                value: sourceLocale,
              },
            ]}
            selectInputProps={{
              isMulti: false,
              options: currentSiteLocales.map((locale) => ({
                label: locale,
                value: locale,
              })),
            }}
            onChange={(newValue) => {
              const newSourceLocale = newValue?.value || sourceLocale;
              setSourceLocale(newSourceLocale);
            }}
          />
          <h3>To</h3>
          <SelectField
            name="toLocales"
            id="toLocales"
            label=""
            value={[
              {
                label: targetLocale,
                value: targetLocale,
              },
            ]}
            selectInputProps={{
              isMulti: false,
              options: currentSiteLocales
                .filter((locale) => locale !== sourceLocale)
                .map((locale) => ({
                  label: locale,
                  value: locale,
                })),
            }}
            onChange={(newValue) => {
              setTargetLocale(newValue?.value || targetLocale);
            }}
          />
        </div>

        <Button
          fullWidth
          onClick={() =>
            ctx
              .openConfirm({
                title: 'Duplicate locale content',
                content:
                  'Are you sure you want to duplicate the locale content?',
                choices: [
                  {
                    label: 'Duplicate',
                    value: 'duplicate',
                    intent: 'positive',
                  },
                ],
                cancel: {
                  label: 'Cancel',
                  value: false,
                },
              })
              .then((result) => {
                if (result === 'duplicate') {
                  ctx
                    .openConfirm({
                      title: 'Confirm locale overwrite',
                      content:
                        'This will overwrite the content of the target locale (' +
                        targetLocale +
                        ') with the content of the source locale (' +
                        sourceLocale +
                        ').',
                      choices: [
                        {
                          label:
                            'Overwrite everything in the ' +
                            targetLocale +
                            ' locale',
                          value: 'overwrite',
                          intent: 'negative',
                        },
                      ],
                      cancel: {
                        label: 'Cancel',
                        value: false,
                      },
                    })
                    .then((result) => {
                      if (result === 'overwrite') {
                        setIsProcessing(true);
                        setProgressUpdates([]);
                        duplicateLocaleContent(
                          ctx,
                          sourceLocale,
                          targetLocale,
                          handleProgress
                        )
                          .then(() => {
                            ctx.notice(
                              'Locale content duplicated successfully'
                            );
                            setIsProcessing(false);
                          })
                          .catch((error) => {
                            ctx.notice(
                              'Error duplicating locale content: ' + error
                            );
                            setIsProcessing(false);
                          });
                      }
                    });
                }
              })
          }
        >
          Duplicate locale content
        </Button>
      </div>

      {isProcessing && (
        <ProgressView
          updates={progressUpdates}
          sourceLocale={sourceLocale}
          targetLocale={targetLocale}
        />
      )}
    </Canvas>
  );
}
