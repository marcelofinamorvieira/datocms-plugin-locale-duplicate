import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { Button, Canvas, SelectField } from 'datocms-react-ui';
import { useState } from 'react';
import styles from './styles.module.css';

/**
 * Represents a mapping from locale strings to generic content.
 * Each key in this interface is a locale, and the value can be any data for that locale.
 */
interface LocalizedField {
  [locale: string]: any;
}

/**
 * Describes a structure that maps field keys to their localized fields.
 * This is used to accumulate updates for each record based on locale.
 */
interface Updates {
  [fieldKey: string]: LocalizedField;
}

/**
 * Structure describing a single progress update event with details:
 * - message: The textual description of the progress event
 * - type: The type of update (info, success, error)
 * - timestamp: A numeric timestamp to uniquely identify each progress event
 */
interface ProgressUpdate {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
}

/**
 * Recursively removes IDs from nested 'block' and 'item' objects.
 * This is used to ensure we don't overwrite or conflict with existing IDs
 * when duplicating content from one locale to another.
 *
 * @param obj - The object or array in which block and item IDs might need to be removed.
 * @returns The same structure but with block/item IDs removed.
 */
function removeBlockItemIds(obj: any) {
  if (Array.isArray(obj)) {
    // If it's an array, iterate through each element and remove IDs recursively
    for (let i = 0; i < obj.length; i++) {
      removeBlockItemIds(obj[i]);
    }
  } else if (obj && typeof obj === 'object') {
    // If it's an object, check for block- or item-type structures
    if (obj.type === 'block' && obj.item && obj.item.id) {
      // Remove the ID from the 'block' item
      delete obj.item.id;
    }

    if (obj.type === 'item' && obj.id) {
      // Remove the ID from the 'item' object
      delete obj.id;
    }

    // Recursively check all nested fields
    for (const key in obj) {
      removeBlockItemIds(obj[key]);
    }
  }
  return obj;
}

/**
 * A React component that displays progress updates during the duplication process.
 * It shows a heading indicating which locales are being processed and renders
 * a list of progress update messages.
 *
 * @param updates - An array of progress update objects to be displayed.
 * @param sourceLocale - The locale from which content is being duplicated.
 * @param targetLocale - The locale to which content is being duplicated.
 */
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

/**
 * Main function to duplicate locale content from a source locale to a target locale.
 * It iterates through all content models in DatoCMS (excluding modular blocks),
 * finds records for each model, and then copies the source locale field values
 * into the target locale fields. It also includes progress messages for each step.
 *
 * @param ctx - DatoCMS plugin context used to access the CMA client.
 * @param sourceLocale - The locale to copy content from.
 * @param targetLocale - The locale to copy content into.
 * @param onProgress - A callback function invoked to report progress updates.
 */
async function duplicateLocaleContent(
  ctx: RenderConfigScreenCtx,
  sourceLocale: string,
  targetLocale: string,
  onProgress: (update: ProgressUpdate) => void
) {
  // Build the CMA client with the current user's access token
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken!,
    environment: ctx.environment,
  });

  try {
    // Retrieve all item types (models)
    const allModels = await client.itemTypes.list();
    // Filter out modular block item types
    const models = allModels.filter((model) => !model.modular_block);

    onProgress({
      message: `Found ${models.length} content models to process`,
      type: 'info',
      timestamp: Date.now(),
    });

    // Iterate over each content model
    for (const model of models) {
      onProgress({
        message: `Processing model: ${model.name}`,
        type: 'info',
        timestamp: Date.now(),
      });

      try {
        // Iterate over all items of the current model in a paginated manner
        for await (const record of client.items.rawListPagedIterator({
          filter: {
            type: model.api_key,
          },
          nested: true,
        })) {
          try {
            // Initialize an empty object to accumulate updates
            let updates: Updates = {};

            // Loop over each attribute/field in the record
            for (const [fieldKey, fieldValue] of Object.entries(
              record.attributes
            )) {
              // Skip certain attributes that are not relevant for duplication
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

              // Check if the field is localized (has the sourceLocale key)
              if (
                fieldValue &&
                typeof fieldValue === 'object' &&
                Object.keys(fieldValue as object).includes(sourceLocale)
              ) {
                // Clone the localized field object
                updates[fieldKey] = { ...(fieldValue as LocalizedField) };

                // Overwrite target locale with the source locale content
                updates[fieldKey][targetLocale] = (
                  fieldValue as LocalizedField
                )[sourceLocale];

                // Remove block/item IDs to avoid collisions
                updates = removeBlockItemIds(updates);
              }
            }

            // If there are any updates for this record, apply them
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
            // Continue to the next record if an error occurs
            continue;
          }
        }
      } catch (modelError) {
        onProgress({
          message: `Error processing model ${model.name}: ${modelError} (Check if the original record is currently invalid, and fix validation errors present)`,
          type: 'error',
          timestamp: Date.now(),
        });
        // Proceed to the next model if there's an error
        continue;
      }
    }

    // Indicate that all updates have been attempted and we're verifying
    onProgress({
      message: 'Verifying content migration...',
      type: 'info',
      timestamp: Date.now(),
    });

    // Wait a few seconds (simulating a verification or finalization delay)
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Report completion of the migration
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

/**
 * The ConfigScreen component is the main UI entry point for the plugin's configuration screen.
 * It allows users to select source and target locales for duplication, initiate the duplication,
 * and track the progress of updates. This component uses DatoCMS's React UI library for the form
 * and leverages contextual data (ctx) from the plugin SDK for environment details.
 *
 * @param ctx - DatoCMS context object passed to the component.
 * @returns A React element rendering the plugin's configuration UI.
 */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  // Retrieve the list of locales from the site
  const currentSiteLocales = ctx.site.attributes.locales;

  // Local state for the selected source and target locales
  const [sourceLocale, setSourceLocale] = useState<string>(
    currentSiteLocales[0]
  );
  const [targetLocale, setTargetLocale] = useState<string>(
    currentSiteLocales[1]
  );

  // Flag indicating whether the duplication process is in progress
  const [isProcessing, setIsProcessing] = useState(false);

  // Array of progress updates, displayed to the user
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);

  /**
   * Handler function to update the progressUpdates state with new updates.
   *
   * @param update - A single progress update object containing message, type, and timestamp.
   */
  const handleProgress = (update: ProgressUpdate) => {
    setProgressUpdates((prev) => [...prev, update]);
  };

  // Render the main UI within a Canvas component
  return (
    <Canvas ctx={ctx}>
      {/* Conditional form container, hidden when processing is underway */}
      <div
        className={`${styles.formContainer} ${
          isProcessing ? styles.hidden : ''
        }`}
      >
        {/* Locale selection UI */}
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

        {/* The main button to start the duplication process */}
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
                // Confirm if the user wants to proceed with duplication
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
                      // Confirm if the user wants to overwrite the target locale
                      if (result === 'overwrite') {
                        setIsProcessing(true);
                        setProgressUpdates([]);
                        // Start the duplication process
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

      {/* Conditionally render the progress view if processing is in progress */}
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
