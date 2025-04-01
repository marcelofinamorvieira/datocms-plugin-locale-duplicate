/**
 * @file ConfigScreen.tsx
 * @description Main configuration screen for the DatoCMS Locale Duplicate plugin.
 * This plugin enables content editors to duplicate content from one locale to another,
 * maintaining structured content relationships while properly handling nested blocks.
 * 
 * This file contains the UI components and core business logic for locale duplication.
 */

// External dependencies
import { buildClient } from '@datocms/cma-client-browser';
import type { RenderConfigScreenCtx } from 'datocms-plugin-sdk';
import { 
  Button, 
  Canvas, 
  SelectField, 
  Form, 
  FieldGroup, 
  Section, 
  Spinner
} from 'datocms-react-ui';
import { useState, useEffect, useRef } from 'react';
import styles from './styles.module.css';
import ISO6391 from 'iso-639-1';
import * as countryList from 'country-list';

/**
 * Represents a mapping from locale strings to generic content.
 * Each key in this interface is a locale identifier (e.g., 'en', 'fr'),
 * and the value is the content in that locale.
 * 
 * @interface LocalizedField
 */
interface LocalizedField {
  [locale: string]: unknown;
}

/**
 * Describes a structure that maps field keys to their localized fields.
 * This is used to accumulate updates for each record based on locale.
 * 
 * @interface Updates
 * @example
 * // Example structure:
 * {
 *   "title": { "en": "Title", "fr": "Titre" },
 *   "description": { "en": "Description", "fr": "Description" }
 * }
 */
interface Updates {
  [fieldKey: string]: LocalizedField;
}

/**
 * Structure describing a single progress update event.
 * Used to communicate the status of the duplication process to the user.
 * 
 * @interface ProgressUpdate
 * @property {string} message - The textual description of the progress event
 * @property {'info' | 'success' | 'error'} type - The type of update which determines styling
 * @property {number} timestamp - A numeric timestamp to uniquely identify each progress event
 * @property {number} [progress] - Optional percentage value to indicate overall process completion
 * @property {string} [modelId] - Optional model ID that this update relates to
 * @property {string} [modelName] - Optional model name for display purposes
 * @property {string} [recordId] - Optional record ID that this update relates to
 */
interface ProgressUpdate {
  message: string;
  type: 'info' | 'success' | 'error';
  timestamp: number;
  progress?: number;
  modelId?: string;
  modelName?: string;
  recordId?: string;
}

/**
 * Represents statistics for the duplication process
 * 
 * @interface DuplicationStats
 * @property {number} totalModels - Total number of models processed
 * @property {number} totalRecords - Total number of records processed
 * @property {number} successfulRecords - Number of records successfully updated
 * @property {number} failedRecords - Number of records that failed to update
 * @property {Record<string, { success: number, error: number, total: number, name: string, processedRecordIds: Record<string, boolean> }>} modelStats - Statistics per model
 * @property {number} startTime - Timestamp when the process started
 * @property {number} endTime - Timestamp when the process ended
 */
interface DuplicationStats {
  totalModels: number;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  modelStats: Record<string, { success: number, error: number, total: number, name: string, processedRecordIds: Record<string, boolean> }>;
  startTime: number;
  endTime: number;
}

/**
 * Interface representing a model option for the SelectField component
 */
interface ModelOption {
  label: string;
  value: string;
}

/**
 * Recursively removes IDs from nested 'block' and 'item' objects.
 * This is necessary when duplicating structured content to prevent ID collisions.
 * When content is duplicated from one locale to another, we need to ensure that
 * any nested blocks or items get new IDs assigned by DatoCMS, rather than
 * attempting to reuse existing IDs which could cause conflicts.
 *
 * @param obj - The object or array in which block and item IDs might need to be removed
 * @returns The same structure but with block/item IDs removed
 */
function removeBlockItemIds(obj: unknown): unknown {
  // Handle arrays recursively
  if (Array.isArray(obj)) {
    // If it's an array, iterate through each element and process recursively
    for (let i = 0; i < obj.length; i++) {
      removeBlockItemIds(obj[i]);
    }
  } else if (obj && typeof obj === 'object') {
    // Process objects that might contain block or item structures
    const typedObj = obj as Record<string, unknown>;
    
    // Handle 'block' type objects which have nested 'item' objects with IDs
    if (
      typedObj.type === 'block' && 
      typedObj.item && 
      typeof typedObj.item === 'object' && 
      typedObj.item !== null
    ) {
      const itemObj = typedObj.item as { id?: unknown };
      if ('id' in itemObj) {
        // Remove the ID by setting to undefined rather than using delete operator
        itemObj.id = undefined;
      }
    }

    // Handle 'item' type objects which have direct IDs
    if (
      typedObj.type === 'item' && 
      'id' in typedObj
    ) {
      // Remove the ID by setting to undefined rather than using delete operator
      (typedObj as { id?: unknown }).id = undefined;
    }

    // Process all properties of the object recursively
    for (const key in typedObj) {
      removeBlockItemIds(typedObj[key]);
    }
  }
  return obj;
}

/**
 * Core function to duplicate locale content from one locale to another.
 * 
 * This function performs the following steps:
 * 1. Fetches all content models from DatoCMS (excluding modular blocks)
 * 2. For each model, fetches all records
 * 3. For each record, copies localized fields from source to target locale
 * 4. Handles structured content by removing IDs to prevent collisions
 * 5. Updates records via the CMA API and provides progress updates
 *
 * @async
 * @param ctx - DatoCMS plugin context providing access to the CMA client
 * @param sourceLocale - The locale identifier to copy content from
 * @param targetLocale - The locale identifier to copy content into
 * @param onProgress - Callback function to report progress during the operation
 * @param selectedModelIds - Optional array of model IDs to process (if not provided, all models are processed)
 * @param abortSignal - Optional signal to abort the process
 * @throws Will throw an error if API requests fail or if content cannot be updated
 */
async function duplicateLocaleContent(
  ctx: RenderConfigScreenCtx,
  sourceLocale: string,
  targetLocale: string,
  onProgress: (update: ProgressUpdate) => void,
  selectedModelIds?: string[],
  abortSignal?: { current: boolean }
) {
  // Initialize the CMA client with the current user's access token
  // Use empty string fallback to ensure type safety
  const client = buildClient({
    apiToken: ctx.currentUserAccessToken || '',
    environment: ctx.environment,
  });

  try {
    // Step 1: Retrieve and filter content models
    const allModels = await client.itemTypes.list();
    // We exclude modular blocks as they're handled differently
    let models = allModels.filter((model) => !model.modular_block);
    
    // If selectedModelIds is provided, filter models to include only those selected
    if (selectedModelIds && selectedModelIds.length > 0) {
      models = models.filter(model => selectedModelIds.includes(model.id));
    }

    onProgress({
      message: `Found ${models.length} content models to process`,
      type: 'info',
      timestamp: Date.now(),
      progress: 5, // Initial progress indication
    });

    // Step 2: Process each content model
    for (let i = 0; i < models.length; i++) {
      // Check if abort was requested before processing each model
      if (abortSignal?.current) {
        onProgress({
          message: 'Process aborted by user',
          type: 'error',
          timestamp: Date.now(),
          progress: 5, // Initial progress indication
        });
        return;
      }
      
      const model = models[i];
      const modelProgress = 5 + Math.round((i / models.length) * 90); // Progress from 5% to 95%
      
      onProgress({
        message: `Processing model: ${model.name}`,
        type: 'info',
        timestamp: Date.now(),
        progress: modelProgress,
        modelId: model.id,
        modelName: model.name
      });

      try {
        // Step 3: Retrieve all records for the current model
        // Using async iterator for efficient pagination of potentially large datasets
        for await (const record of client.items.rawListPagedIterator({
          filter: {
            type: model.api_key,
          },
          nested: true, // Include nested records for structured content
        })) {
          // Check if abort was requested before processing each record
          if (abortSignal?.current) {
            onProgress({
              message: 'Process aborted by user',
              type: 'error',
              timestamp: Date.now(),
              progress: modelProgress,
            });
            return;
          }
          
          try {
            // Initialize container for updates to this record
            let updates: Updates = {};

            // Step 4: Analyze each field in the record
            for (const [fieldKey, fieldValue] of Object.entries(
              record.attributes
            )) {
              // Skip non-localizable or system fields
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

              // Step 5: Check if field is localized and contains the source locale
              if (
                fieldValue &&
                typeof fieldValue === 'object' &&
                Object.keys(fieldValue as object).includes(sourceLocale)
              ) {
                // Clone the localized field values
                updates[fieldKey] = { ...(fieldValue as LocalizedField) };

                // Step 6: Copy content from source locale to target locale
                updates[fieldKey][targetLocale] = (
                  fieldValue as LocalizedField
                )[sourceLocale];

                // Step 7: Process structured content to remove IDs
                updates = removeBlockItemIds(updates) as Updates;
              }
            }

            // Step 8: Apply updates if there are any changes to make
            if (Object.keys(updates).length > 0) {
              try {
                await client.items.update(record.id, updates);
                onProgress({
                  message: '',
                  type: 'success',
                  timestamp: Date.now(),
                  recordId: record.id,
                  modelId: model.id,
                  modelName: model.name
                });
              } catch (updateError: unknown) {
                onProgress({
                  message: 'Failed to update record: Check if the original record is currently invalid, and fix validation errors present',
                  type: 'error',
                  timestamp: Date.now(),
                  recordId: record.id,
                  modelId: model.id,
                  modelName: model.name
                });
                throw updateError;
              }
            }
          } catch (error) {
            // Error handling for the current record is complete, moving to next record
            // Individual record errors don't halt the entire process
          }
        }
      } catch (modelError) {
        onProgress({
          message: `Error processing model ${model.name}: ${modelError} (Check if the original record is currently invalid, and fix validation errors present)`,
          type: 'error',
          timestamp: Date.now(),
          modelId: model.id,
          modelName: model.name
        });
        // Error handling for the current model is complete, moving to next model
        // Individual model errors don't halt the entire process
      }
    }

    // Step 9: Finalize and report completion
    onProgress({
      message: 'Verifying content migration...',
      type: 'info',
      timestamp: Date.now(),
      progress: 100, // Final progress indication
    });

    // Add a small delay to make the completion more noticeable to the user
    await new Promise((resolve) => setTimeout(resolve, 5000));

    onProgress({
      message: 'Migration completed successfully!',
      type: 'success',
      timestamp: Date.now(),
    });
  } catch (error) {
    // Handle any unexpected errors that weren't caught by more specific handlers
    onProgress({
      message: `Error during migration: ${error} (Check if the original record is currently invalid, and fix validation errors present)`,
      type: 'error',
      timestamp: Date.now(),
    });
    throw error;
  }
}

/**
 * The ConfigScreen component is the main UI entry point for the plugin.
 * 
 * This component provides:  
 * 1. A user interface for selecting source and target locales  
 * 2. Controls to initiate the duplication process  
 * 3. Confirmation dialogs to prevent accidental operations  
 * 4. Real-time progress updates during the duplication  
 *
 * @component
 * @param props - Component properties
 * @param props.ctx - DatoCMS plugin context that provides access to site configuration and APIs
 * @returns A React element containing the plugin's configuration interface
 */
export default function ConfigScreen({ ctx }: { ctx: RenderConfigScreenCtx }) {
  // Retrieve available locales from the DatoCMS site configuration
  const currentSiteLocales = ctx.site.attributes.locales;

  // State management for locale selection
  const [sourceLocale, setSourceLocale] = useState<string>(
    currentSiteLocales[0] // Default to first locale as source
  );
  const [targetLocale, setTargetLocale] = useState<string>(
    currentSiteLocales[1] // Default to second locale as target
  );

  // State for tracking the duplication process
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  const [isAborting, setIsAborting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [duplicationStats, setDuplicationStats] = useState<DuplicationStats>({
    totalModels: 0,
    totalRecords: 0,
    successfulRecords: 0,
    failedRecords: 0,
    modelStats: {},
    startTime: 0,
    endTime: 0
  });
  
  // Create a ref to track current stats to avoid state update synchronization issues
  const statsRef = useRef<DuplicationStats>({
    totalModels: 0,
    totalRecords: 0,
    successfulRecords: 0,
    failedRecords: 0,
    modelStats: {},
    startTime: 0,
    endTime: 0
  });
  
  // Reference to track if the process should be aborted
  const abortProcessRef = useRef(false);

  // State for available models and selected models
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModels, setSelectedModels] = useState<ModelOption[]>([]);

  // New state for tracking expanded sections
  const [expandedSections, setExpandedSections] = useState<{
    statistics: boolean;
    models: boolean;
    timing: boolean;
    successRate: boolean;
    failures: boolean;
  }>({
    statistics: false,
    models: false, 
    timing: false,
    successRate: false,
    failures: false
  });

  /**
   * Helper function to generate a formatted locale label with language name and code
   * @param localeCode - The locale code (e.g., 'en', 'it', 'fr', 'en-US', 'en-EG')
   * @returns Formatted string with language name and code (e.g., 'English [en]', 'English (Egypt) [en-EG]')
   */
  const getLocaleLabel = (localeCode: string): string => {
    // Split the locale into language and country parts (if present)
    const parts = localeCode.split('-');
    const languageCode = parts[0];
    const countryCode = parts.length > 1 ? parts[1] : undefined;
    
    // Get the language name from ISO6391
    const languageName = ISO6391.getName(languageCode) || languageCode;
    
    // Get the country name if a country code exists
    let countryName: string | undefined;
    if (countryCode) {
      // The country-list package expects uppercase country codes
      countryName = countryList.getName(countryCode.toUpperCase());
    }
    
    // Format the label based on whether there's a country variant
    if (countryName) {
      // For country-specific variants, format as: "English (Egypt) [en-EG]"
      return `${languageName} (${countryName}) [${localeCode}]`;
    }
    
    // For standard locales, format as: "English [en]"
    return `${languageName} [${localeCode}]`;
  };

  // Fetch available models on component mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        // Initialize the CMA client
        const client = buildClient({
          apiToken: ctx.currentUserAccessToken || '',
          environment: ctx.environment,
        });

        // Fetch all item types (models)
        const models = await client.itemTypes.list();
        
        // Filter out modular blocks and convert to options format
        const modelOptions = models
          .filter(model => !model.modular_block)
          .map(model => ({
            label: model.name,
            value: model.id
          }));
          
        // Set available models
        setAvailableModels(modelOptions);
        
        // Initialize selected models with all models
        setSelectedModels(modelOptions);
      } catch (error) {
        console.error('Error fetching models:', error);
        ctx.notice(`Error fetching models: ${error}`);
      }
    };

    fetchModels();
  }, [ctx]);
  
  /**
   * Updates statistics based on progress updates
   */
  const updateStatistics = (update: ProgressUpdate) => {
    console.log('Processing update:', update);
    
    // Use the ref to ensure we're always working with the latest state
    const stats = { ...statsRef.current };
    
    // Update model stats if model info is provided
    if (update.modelId && update.modelName) {
      // Initialize model stats if not present
      if (!stats.modelStats[update.modelId]) {
        stats.modelStats[update.modelId] = {
          success: 0,
          error: 0,
          total: 0,
          name: update.modelName,
          processedRecordIds: {}
        };
        // Count unique models
        stats.totalModels = Object.keys(stats.modelStats).length;
      }
      
      // For record updates, update success/error counts - prevent double counting
      if (update.recordId) {
        const modelStats = stats.modelStats[update.modelId];
        
        // Check if we've already processed this record
        if (!modelStats.processedRecordIds[update.recordId]) {
          modelStats.processedRecordIds[update.recordId] = true;
          modelStats.total++;
          stats.totalRecords++;
          
          if (update.type === 'success') {
            stats.successfulRecords++;
            modelStats.success++;
          } else if (update.type === 'error') {
            stats.failedRecords++;
            modelStats.error++;
          }
        }
      }
    }
    
    // Update the ref first
    statsRef.current = stats;
    
    // Then update the state
    setDuplicationStats(stats);
    console.log('Updated stats:', stats);
  };

  /**
   * Handler function to add new progress updates to the state.
   * This is passed to the duplicateLocaleContent function as a callback.
   *
   * @param update - A progress update object with message, type, and timestamp
   */
  const handleProgress = (update: ProgressUpdate) => {
    setProgressUpdates((prev) => [...prev, update]);
    // Update progress percentage if provided
    if (update.progress !== undefined) {
      setProgressPercentage(update.progress);
    }
    
    // Update statistics
    updateStatistics(update);
  };

  /**
   * Handles the abortion of the duplication process
   */
  const handleAbortProcess = () => {
    ctx.openConfirm({
      title: 'Abort Process',
      content: 'Are you sure you want to abort the duplication process? This will stop the operation but changes already made will remain.',
      choices: [
        {
          label: 'Yes, abort process',
          value: 'abort',
          intent: 'negative',
        },
      ],
      cancel: {
        label: 'No, continue',
        value: false,
      },
    }).then((result) => {
      if (result === 'abort') {
        setIsAborting(true);
        abortProcessRef.current = true;
        
        // Add an update to the operation log
        handleProgress({
          message: 'Aborting process... Please wait while current operations finish.',
          type: 'error',
          timestamp: Date.now(),
        });
      }
    });
  };
  
  return (
    <Canvas ctx={ctx}>
      {/* Form container - hidden during processing or when summary is shown */}
      <div
        className={`${styles.formContainer} ${
          isProcessing || showSummary ? styles.hidden : ''
        }`}
      >
        <Form>
          <Section title="Locale Duplication Settings">
            <FieldGroup>
              {/* Locale selection interface - side by side layout */}
              <div style={{ display: 'flex', gap: 'var(--spacing-m)' }}>
                <div style={{ flex: 1 }}>
                  <SelectField
                    name="fromLocale"
                    id="fromLocale"
                    label="Source Locale"
                    hint="Select the locale you want to copy content from"
                    value={[
                      {
                        label: getLocaleLabel(sourceLocale),
                        value: sourceLocale,
                      },
                    ]}
                    selectInputProps={{
                      isMulti: false,
                      options: currentSiteLocales.map((locale) => ({
                        label: getLocaleLabel(locale),
                        value: locale,
                      })),
                    }}
                    onChange={(newValue) => {
                      const newSourceLocale = newValue?.value || sourceLocale;
                      setSourceLocale(newSourceLocale);
                    }}
                  />
                </div>

                <div style={{ flex: 1 }}>
                  <SelectField
                    name="toLocales"
                    id="toLocales"
                    label="Target Locale"
                    hint="Select the locale you want to copy content to"
                    value={[
                      {
                        label: getLocaleLabel(targetLocale),
                        value: targetLocale,
                      },
                    ]}
                    selectInputProps={{
                      isMulti: false,
                      options: currentSiteLocales
                        .filter((locale) => locale !== sourceLocale) // Filter out the source locale
                        .map((locale) => ({
                          label: getLocaleLabel(locale),
                          value: locale,
                        })),
                    }}
                    onChange={(newValue) => {
                      setTargetLocale(newValue?.value || targetLocale);
                    }}
                  />
                </div>
              </div>
            </FieldGroup>
          </Section>

          <Section title="Content Model Selection">
            <FieldGroup>
              <div>
                <SelectField
                  name="models"
                  id="models"
                  label="Models to duplicate"
                  hint="Select which content models you want to include in the duplication process"
                  value={selectedModels}
                  selectInputProps={{
                    isMulti: true,
                    options: availableModels,
                  }}
                  onChange={(newValue) => {
                    setSelectedModels(Array.isArray(newValue) ? newValue : []);
                  }}
                />
              </div>
            </FieldGroup>
          </Section>

          <FieldGroup>
            {/* Action button with confirmation flow */}
            <Button
              fullWidth
              buttonType="primary"
              buttonSize="l"
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
                    // First confirmation step
                    if (result === 'duplicate') {
                      ctx
                        .openConfirm({
                          title: 'Confirm locale overwrite',
                          content: `This will overwrite the content of the target locale (${getLocaleLabel(targetLocale)}) with the content of the source locale (${getLocaleLabel(sourceLocale)}).`,
                          choices: [
                            {
                              label: `Overwrite everything in the ${getLocaleLabel(targetLocale)} locale`,
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
                          // Second confirmation step with more explicit warning
                          if (result === 'overwrite') {
                            // Initialize processing state
                            setIsProcessing(true);
                            setProgressUpdates([]);
                            setShowSummary(false);
                            
                            // Initialize statistics
                            const initialStats = {
                              totalModels: 0,
                              totalRecords: 0,
                              successfulRecords: 0,
                              failedRecords: 0,
                              modelStats: {},
                              startTime: Date.now(),
                              endTime: 0
                            };
                            
                            // Set both the state and the ref
                            setDuplicationStats(initialStats);
                            statsRef.current = initialStats;
                            
                            // Execute the duplication process
                            duplicateLocaleContent(
                              ctx,
                              sourceLocale,
                              targetLocale,
                              handleProgress,
                              selectedModels.map(model => model.value),
                              abortProcessRef
                            )
                              .then(() => {
                                // Set end time for stats - get current stats from ref
                                const finalStats = {
                                  ...statsRef.current,
                                  endTime: Date.now()
                                };
                                
                                // Update both the ref and state
                                statsRef.current = finalStats;
                                setDuplicationStats(finalStats);
                                
                                // Log final statistics for debugging
                                console.log('Final stats being saved:', finalStats);
                                
                                // Check if the process was aborted
                                if (abortProcessRef.current) {
                                  ctx.notice('Duplication process was aborted');
                                  setShowSummary(false);
                                } else {
                                  // Handle successful completion
                                  ctx.notice('Locale content duplicated successfully');
                                  // Show summary screen
                                  setShowSummary(true);
                                  
                                  // Force a log of final stats
                                  console.log('Final duplication stats:', duplicationStats);
                                }
                                setIsProcessing(false);
                                setIsAborting(false);
                                abortProcessRef.current = false;
                              })
                              .catch((error) => {
                                // Handle errors during duplication
                                ctx.notice(
                                  `Error duplicating locale content: ${error}`
                                );
                                setDuplicationStats(prev => ({
                                  ...prev,
                                  endTime: Date.now()
                                }));
                                setIsProcessing(false);
                                setIsAborting(false);
                                abortProcessRef.current = false;
                                // Still show summary even if there were errors
                                setShowSummary(true);
                              });
                          }
                        });
                    }
                  })
              }
            >
              Duplicate locale content
            </Button>
          </FieldGroup>
        </Form>
      </div>

      {/* Progress view - only shown during processing */}
      {isProcessing && (
        <div className={styles.progressContainer}>
          <h2 className={styles.progressHeading}>
            Duplicating content from {getLocaleLabel(sourceLocale)} to {getLocaleLabel(targetLocale)}
          </h2>
          
          <Section title="Progress Status">
            {/* Custom progress bar to show overall completion status */}
            <div style={{ 
              marginBottom: 'var(--spacing-l)',
              padding: 'var(--spacing-m)',
              backgroundColor: 'var(--light-bg-color, #f5f5f5)',
              borderRadius: 'var(--border-radius)',
              boxShadow: 'var(--box-shadow-light)'
            }}>
              {/* Progress percentage and spinner */}
              <div style={{ 
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 'var(--spacing-s)'
              }}>
                <div style={{ 
                  fontSize: 'var(--font-size-l)',
                  fontWeight: 'bold',
                  color: 'var(--accent-color)'
                }}>
                  {progressPercentage}% Complete
                </div>
                <Spinner size={24} />
              </div>
              
              {/* Progress bar */}
              <div style={{ 
                width: '100%', 
                height: '10px', 
                backgroundColor: 'var(--light-color)', 
                borderRadius: 'var(--border-radius)',
                overflow: 'hidden'
              }}>
                <div 
                  style={{ 
                    width: `${progressPercentage}%`, 
                    height: '100%', 
                    background: 'linear-gradient(to right, var(--accent-color), var(--accent-color-light, var(--accent-color)))',
                    borderRadius: 'var(--border-radius)',
                    transition: 'width 0.3s ease-in-out',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                  }} 
                />
              </div>
              
              {/* Current operation description */}
              <div style={{ 
                marginTop: 'var(--spacing-s)',
                fontSize: 'var(--font-size-s)',
                color: 'var(--base-body-color)'
              }}>
                {progressUpdates.length > 0 && progressUpdates[progressUpdates.length - 1].message}
              </div>
            </div>

            {progressUpdates.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: 'var(--spacing-l)',
                backgroundColor: 'var(--light-bg-color, #f5f5f5)',
                borderRadius: 'var(--border-radius)',
                boxShadow: 'var(--box-shadow-light)'
              }}>
                <Spinner size={48} />
                <div style={{ 
                  marginTop: 'var(--spacing-m)',
                  fontSize: 'var(--font-size-m)',
                  fontWeight: 'bold'
                }}>
                  Initializing duplication process...
                </div>
              </div>
            ) : (
              <div>
                <h3 style={{ 
                  margin: '0 0 var(--spacing-m) 0',
                  fontSize: 'var(--font-size-m)',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span>Operation Console</span>
                  <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'normal', opacity: 0.7 }}>
                    {progressUpdates.length} {progressUpdates.length === 1 ? 'entry' : 'entries'}
                  </span>
                </h3>
                
                <div 
                  style={{ 
                    maxHeight: '300px', 
                    overflowY: 'auto',
                    backgroundColor: 'var(--light-bg-color, #f5f5f5)',
                    borderRadius: 'var(--border-radius)',
                    padding: 'var(--spacing-xs)'
                  }}
                  ref={(el) => {
                    // Auto-scroll to top when new items are added
                    if (el) {
                      el.scrollTop = 0;
                    }
                  }}
                >
                  <div>
                    {progressUpdates.slice().reverse().map((update, index) => {
                      // Format timestamp
                      const timestamp = new Date(update.timestamp);
                      const formattedTime = timestamp.toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        second: '2-digit' 
                      });
                      
                      const trueIndex = progressUpdates.length - index - 1;
                      
                      // Determine prefix based on message type
                      let prefix: string;
                      let prefixColor: string;
                      
                      switch (update.type) {
                        case 'info':
                          prefix = 'INFO';
                          prefixColor = 'var(--accent-color, #06f)';
                          break;
                        case 'success':
                          prefix = 'OK';
                          prefixColor = 'var(--green-color, #00c66b)';
                          break;
                        case 'error':
                          prefix = 'ERR';
                          prefixColor = 'var(--red-color, #e21b3c)';
                          break;
                        default:
                          prefix = 'INFO';
                          prefixColor = 'var(--accent-color, #06f)';
                          break;
                      }
                      
                      return (
                        <div
                          key={`${update.timestamp}-${trueIndex}`}
                          className={`${styles.updateItem} ${styles[update.type]}`}
                        >
                          <div style={{ display: 'flex', width: '100%' }}>
                            <span style={{ marginRight: 'var(--spacing-m)', fontSize: '1.2em' }}>&#128221;</span>
                            <span style={{ 
                              marginRight: 'var(--spacing-m)',
                              color: 'var(--light-body-color, #666)',
                              fontSize: '0.9em',
                              flexShrink: 0,
                              width: '45px',
                              textAlign: 'right'
                            }}>
                              [{String(trueIndex + 1).padStart(3, '0')}]
                            </span>
                            <span style={{ 
                              marginRight: 'var(--spacing-m)',
                              color: 'var(--light-body-color, #666)',
                              fontSize: '0.9em',
                              flexShrink: 0
                            }}>
                              {formattedTime}
                            </span>
                            <span style={{ 
                              marginRight: 'var(--spacing-m)',
                              fontWeight: 'bold',
                              flexShrink: 0,
                              width: '45px',
                              color: prefixColor
                            }}>
                              [{prefix}]
                            </span>
                            <span style={{ 
                              flexGrow: 1,
                              color: 'var(--base-body-color, #333)'
                            }}>
                              {update.message}
                              {update.recordId && (
                                <span>
                                  {update.message ? ' ' : ''}ID: {update.recordId}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            
            {/* Abort button */}
            <div style={{ marginTop: 'var(--spacing-l)' }}>
              <Button
                fullWidth
                buttonType="negative"
                buttonSize="l"
                disabled={isAborting}
                onClick={handleAbortProcess}
              >
                {isAborting ? 'Aborting...' : 'Abort Process'}
              </Button>
            </div>
          </Section>
        </div>
      )}
      
      {/* Summary view - only shown after processing */}
      {showSummary && (
        <div style={{ padding: 'var(--spacing-m)' }}>
          <h2 style={{ 
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'bold',
            marginBottom: 'var(--spacing-l)',
            color: 'var(--accent-color, #6c5ce7)',
            textAlign: 'center',
            position: 'relative',
            paddingBottom: 'var(--spacing-xs)'
          }}>
            Duplication Summary
            <span style={{ 
              display: 'block', 
              width: '60px', 
              height: '2px', 
              backgroundColor: 'var(--accent-color, #6c5ce7)', 
              margin: '12px auto 0',
              borderRadius: '2px'
            }}/>
          </h2>
          
          {/* Duplication Statistics Section */}
          <Section title="Duplication Statistics">
            <div style={{ 
              backgroundColor: 'var(--light-bg-color, #f5f5f5)',
              borderRadius: 'var(--border-radius)',
              overflow: 'hidden',
              marginBottom: 'var(--spacing-l)'
            }}>
              {/* Records Processed */}
              <button 
                type="button"
                onClick={() => setExpandedSections({...expandedSections, models: !expandedSections.models})}
                aria-expanded={expandedSections.models}
                style={{ 
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'var(--spacing-m) var(--spacing-l)',
                  borderBottom: '1px solid var(--border-color, #eee)',
                  cursor: 'pointer',
                  backgroundColor: expandedSections.models ? 'rgba(108, 92, 231, 0.05)' : 'transparent',
                  transition: 'background-color 0.2s ease',
                  width: '100%',
                  border: 'none',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: 'var(--spacing-m)', fontSize: '1.2em' }}>📝</span>
                  <span style={{ 
                    fontSize: 'var(--font-size-m)',
                    fontWeight: 'bold'
                  }}>
                    Records Processed
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ 
                    fontSize: 'var(--font-size-m)',
                    fontWeight: 'bold',
                    color: 'var(--accent-color)',
                    marginRight: 'var(--spacing-s)'
                  }}>
                    {duplicationStats.totalRecords}
                  </span>
                  <span style={{ 
                    transition: 'transform 0.2s',
                    transform: expandedSections.models ? 'rotate(180deg)' : 'rotate(0deg)'
                  }}>▾</span>
                </div>
              </button>
              
              {/* Expanded records details */}
              {expandedSections.models && (
                <div style={{ 
                  padding: 'var(--spacing-m) var(--spacing-l)',
                  backgroundColor: 'rgba(108, 92, 231, 0.05)'
                }}>
                  <h4 style={{ 
                    fontSize: 'var(--font-size-s)',
                    margin: '0 0 var(--spacing-s) 0',
                    color: 'var(--accent-color)'
                  }}>Record Statistics</h4>
                  
                  <table style={{ width: '100%', fontSize: 'var(--font-size-s)' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', paddingBottom: 'var(--spacing-xs)' }}>Status</th>
                        <th style={{ textAlign: 'right', paddingBottom: 'var(--spacing-xs)' }}>Count</th>
                        <th style={{ textAlign: 'right', paddingBottom: 'var(--spacing-xs)' }}>Percentage</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ paddingTop: 'var(--spacing-xs)' }}>
                          <span style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ color: 'var(--green-color)', marginRight: 'var(--spacing-s)' }}>✅</span>
                            Successful
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', paddingTop: 'var(--spacing-xs)' }}>{duplicationStats.successfulRecords}</td>
                        <td style={{ textAlign: 'right', paddingTop: 'var(--spacing-xs)' }}>
                          {duplicationStats.totalRecords > 0 ? 
                            `${Math.round((duplicationStats.successfulRecords / duplicationStats.totalRecords) * 100)}%` : 
                            '0%'}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ paddingTop: 'var(--spacing-xs)' }}>
                          <span style={{ display: 'flex', alignItems: 'center' }}>
                            <span style={{ color: 'var(--red-color)', marginRight: 'var(--spacing-s)' }}>❌</span>
                            Failed
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', paddingTop: 'var(--spacing-xs)' }}>{duplicationStats.failedRecords}</td>
                        <td style={{ textAlign: 'right', paddingTop: 'var(--spacing-xs)' }}>
                          {duplicationStats.totalRecords > 0 ? 
                            `${Math.round((duplicationStats.failedRecords / duplicationStats.totalRecords) * 100)}%` : 
                            '0%'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  
                  {/* Detailed Record Information */}
                  <div style={{ marginTop: 'var(--spacing-m)' }}>
                    <h4 style={{ 
                      fontSize: 'var(--font-size-s)', 
                      margin: '0 0 var(--spacing-s) 0', 
                      color: 'var(--accent-color)',
                      paddingBottom: 'var(--spacing-xs)',
                      borderBottom: '1px solid rgba(108, 92, 231, 0.2)'
                    }}>
                      Record Details
                    </h4>
                    
                    {Object.keys(duplicationStats.modelStats).map(modelId => {
                      const model = duplicationStats.modelStats[modelId];
                      if (model.total === 0) return null;
                      
                      return (
                        <div key={modelId} style={{ marginBottom: 'var(--spacing-l)' }}>
                          <div style={{ 
                            fontWeight: 'bold', 
                            marginBottom: 'var(--spacing-m)',
                            fontSize: 'var(--font-size-s)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: 'var(--spacing-s) var(--spacing-m)',
                            backgroundColor: 'rgba(108, 92, 231, 0.1)',
                            borderRadius: 'var(--border-radius)',
                            boxShadow: 'var(--box-shadow-light)'
                          }}>
                            <span>
                              <span style={{ 
                                display: 'inline-block', 
                                width: '8px', 
                                height: '8px', 
                                backgroundColor: 'var(--accent-color)', 
                                borderRadius: '50%', 
                                marginRight: 'var(--spacing-s)' 
                              }}/>
                              {model.name || 'Unnamed Model'}
                            </span>
                            <span>{model.success}/{model.total} successful</span>
                          </div>
                          
                          {/* List of processed records */}
                          <div style={{ 
                            fontSize: 'var(--font-size-s)', 
                            padding: 'var(--spacing-s)',
                            marginLeft: 'var(--spacing-m)'
                          }}>
                            {/* Filter success records from progress updates */}
                            <div style={{ marginBottom: 'var(--spacing-l)' }}>
                              <h5 style={{ 
                                margin: '0 0 var(--spacing-m) 0', 
                                fontSize: 'var(--font-size-s)',
                                color: 'var(--green-color)',
                                display: 'flex',
                                alignItems: 'center'
                              }}>
                                <span style={{ marginRight: 'var(--spacing-s)', fontSize: '1.1em' }}>👍</span>
                                Successful Records
                              </h5>
                              <div style={{ 
                                maxHeight: '200px', 
                                overflowY: 'auto',
                                padding: 'var(--spacing-m)',
                                backgroundColor: 'rgba(0, 198, 107, 0.05)',
                                borderRadius: 'var(--border-radius)',
                                boxShadow: 'var(--box-shadow-light)'
                              }}>
                                {progressUpdates
                                  .filter(update => update.type === 'success' && update.modelId === modelId && update.recordId)
                                  .map((update, idx) => (
                                    <div key={`${update.timestamp}-${idx}`} style={{ 
                                      padding: 'var(--spacing-m) 0',
                                      borderBottom: idx < progressUpdates.filter(u => u.type === 'success' && u.modelId === modelId).length - 1 ? 
                                        '1px solid rgba(0, 198, 107, 0.1)' : 'none'
                                    }}>
                                      <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between',
                                        marginBottom: 'var(--spacing-xs)'
                                      }}>
                                        <span style={{ fontWeight: 'bold' }}>
                                          ID: {update.recordId}
                                        </span>
                                        <span style={{ color: 'var(--light-body-color)' }}>
                                          {new Date(update.timestamp).toLocaleTimeString()}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                {progressUpdates.filter(update => update.type === 'success' && update.modelId === modelId).length === 0 && (
                                  <div style={{ 
                                    padding: 'var(--spacing-m)', 
                                    color: 'var(--light-body-color)',
                                    textAlign: 'center',
                                    fontStyle: 'italic'
                                  }}>
                                    No successful records for this model
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            {/* Filter failed records from progress updates */}
                            <div>
                              <h5 style={{ 
                                margin: '0 0 var(--spacing-m) 0', 
                                fontSize: 'var(--font-size-s)',
                                color: 'var(--red-color)',
                                display: 'flex',
                                alignItems: 'center'
                              }}>
                                <span style={{ marginRight: 'var(--spacing-s)', fontSize: '1.1em' }}>🚫</span>
                                Failed Records
                              </h5>
                              <div style={{ 
                                maxHeight: '200px', 
                                overflowY: 'auto',
                                padding: 'var(--spacing-m)',
                                backgroundColor: 'rgba(255, 0, 0, 0.05)',
                                borderRadius: 'var(--border-radius)',
                                boxShadow: 'var(--box-shadow-light)'
                              }}>
                                {progressUpdates
                                  .filter(update => update.type === 'error' && update.modelId === modelId && update.recordId)
                                  .map((update, idx) => (
                                    <div key={`${update.timestamp}-${idx}`} style={{ 
                                      padding: 'var(--spacing-m) 0',
                                      borderBottom: idx < progressUpdates.filter(u => u.type === 'error' && u.modelId === modelId).length - 1 ? 
                                        '1px solid rgba(255, 0, 0, 0.1)' : 'none'
                                    }}>
                                      <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 'var(--spacing-xs)'
                                      }}>
                                        <span style={{ fontWeight: 'bold' }}>
                                          ID: {update.recordId}
                                        </span>
                                        <span style={{ color: 'var(--light-body-color)' }}>
                                          {new Date(update.timestamp).toLocaleTimeString()}
                                        </span>
                                      </div>
                                      {update.message && (
                                        <div style={{ 
                                          fontSize: 'var(--font-size-s)', 
                                          color: 'var(--red-color)',
                                          padding: 'var(--spacing-s)',
                                          backgroundColor: 'rgba(255, 0, 0, 0.03)',
                                          borderRadius: 'var(--border-radius-s)',
                                          marginTop: 'var(--spacing-xs)'
                                        }}>
                                          <strong>Error:</strong> {update.message.includes(update.recordId as string) ? 
                                            update.message.replace(`record: ${update.recordId}`, 'record') : 
                                            update.message}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                {progressUpdates.filter(update => update.type === 'error' && update.modelId === modelId).length === 0 && (
                                  <div style={{ 
                                    padding: 'var(--spacing-m)', 
                                    color: 'var(--light-body-color)',
                                    textAlign: 'center',
                                    fontStyle: 'italic'
                                  }}>
                                    No failed records for this model
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Successful Updates */}
              <div style={{ 
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--spacing-m) var(--spacing-l)',
                borderBottom: '1px solid var(--border-color, #eee)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: 'var(--spacing-m)', fontSize: '1.2em' }}>👍</span>
                  <span style={{ 
                    fontSize: 'var(--font-size-m)',
                    fontWeight: 'bold'
                  }}>
                    Successful Updates
                  </span>
                </div>
                <span style={{ 
                  fontSize: 'var(--font-size-m)',
                  fontWeight: 'bold',
                  color: 'var(--green-color, #00c66b)'
                }}>
                  {duplicationStats.successfulRecords}
                </span>
              </div>
              
              {/* Failed Updates */}
              <button
                type="button"
                onClick={() => setExpandedSections({...expandedSections, failures: !expandedSections.failures})}
                aria-expanded={expandedSections.failures}
                style={{ 
                  padding: 'var(--spacing-m) var(--spacing-l)',
                  cursor: 'pointer',
                  backgroundColor: expandedSections.failures ? 'rgba(226, 27, 60, 0.05)' : 'transparent',
                  transition: 'background-color 0.2s ease',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  border: 'none',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border-color, #eee)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: 'var(--spacing-m)', fontSize: '1.2em' }}>
                    {duplicationStats.failedRecords > 0 ? '🚫' : '🙅'}
                  </span>
                  <span style={{ 
                    fontSize: 'var(--font-size-m)',
                    fontWeight: 'bold'
                  }}>
                    Failed Updates
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ 
                    fontSize: 'var(--font-size-m)',
                    fontWeight: 'bold',
                    color: duplicationStats.failedRecords > 0 ? 
                      'var(--red-color, #e21b3c)' : 'var(--light-color, #999)',
                    marginRight: 'var(--spacing-m)'
                  }}>
                    {duplicationStats.failedRecords}
                  </span>
                  <span style={{ 
                    transition: 'transform 0.2s',
                    transform: expandedSections.failures ? 'rotate(180deg)' : 'rotate(0deg)'
                  }}>▾</span>
                </div>
              </button>
              
              {/* Expanded failed records */}
              {expandedSections.failures && duplicationStats.failedRecords > 0 && (
                <div style={{ 
                  backgroundColor: 'rgba(226, 27, 60, 0.05)',
                  padding: 'var(--spacing-m)',
                  borderBottom: '1px solid var(--border-color, #eee)'
                }}>
                  <div>
                    {Object.keys(duplicationStats.modelStats).map(modelId => {
                      const model = duplicationStats.modelStats[modelId];
                      if (model.error === 0) return null;
                      
                      return (
                        <div key={modelId} style={{ marginBottom: 'var(--spacing-m)' }}>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            marginBottom: 'var(--spacing-s)'
                          }}>
                            <span style={{ 
                              fontSize: 'var(--font-size-s)',
                              fontWeight: 'bold',
                              color: 'var(--red-color, #e21b3c)'
                            }}>
                              ❌ {model.name}
                            </span>
                            <span style={{
                              marginLeft: 'var(--spacing-s)',
                              fontSize: 'var(--font-size-xs)',
                              color: 'var(--light-body-color, #999)',
                              backgroundColor: 'rgba(226, 27, 60, 0.1)',
                              padding: '2px 6px',
                              borderRadius: '10px'
                            }}>
                              {model.error} {model.error === 1 ? 'failure' : 'failures'}
                            </span>
                          </div>
                          
                          {/* List of processed records */}
                          <div style={{ 
                            backgroundColor: 'var(--white)',
                            borderRadius: 'var(--border-radius)',
                            padding: 'var(--spacing-s)',
                            border: '1px solid var(--border-color, #eee)',
                            maxHeight: '250px',
                            overflowY: 'auto'
                          }}>
                            {progressUpdates
                              .filter(update => update.type === 'error' && update.modelId === modelId)
                              .map((update, idx) => (
                                <div key={`${update.timestamp}-${idx}`} style={{ 
                                  padding: 'var(--spacing-s) 0',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  borderBottom: idx < progressUpdates.filter(u => u.type === 'error' && u.modelId === modelId).length - 1 ? 
                                    '1px solid rgba(226, 27, 60, 0.1)' : 'none'
                                }}>
                                  <div>
                                    <div style={{ 
                                      display: 'flex', 
                                      justifyContent: 'space-between',
                                      alignItems: 'center'
                                    }}>
                                      <span style={{ fontWeight: 'bold' }}>
                                        ID: {update.recordId}
                                      </span>
                                      <span style={{ color: 'var(--light-body-color)' }}>
                                        {new Date(update.timestamp).toLocaleTimeString()}
                                      </span>
                                    </div>
                                    {update.message && (
                                      <div style={{ 
                                        fontSize: 'var(--font-size-s)', 
                                        color: 'var(--red-color)',
                                        padding: 'var(--spacing-s)',
                                        backgroundColor: 'rgba(255, 0, 0, 0.03)',
                                        borderRadius: 'var(--border-radius-s)',
                                        marginTop: 'var(--spacing-xs)'
                                      }}>
                                        <strong>Error:</strong> {update.message.includes(update.recordId as string) ? 
                                          update.message.replace(`record: ${update.recordId}`, 'record') : 
                                          update.message}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            {progressUpdates.filter(update => update.type === 'error' && update.modelId === modelId).length === 0 && (
                              <div style={{ 
                                padding: 'var(--spacing-m)', 
                                color: 'var(--light-body-color)',
                                textAlign: 'center',
                                fontStyle: 'italic'
                              }}>
                                No failed records for this model
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              {/* Timing Information */}
              <button
                type="button"
                onClick={() => setExpandedSections({...expandedSections, timing: !expandedSections.timing})}
                aria-expanded={expandedSections.timing}
                style={{
                  padding: 'var(--spacing-s) var(--spacing-l)',
                  borderTop: '1px solid var(--border-color, #eee)',
                  cursor: 'pointer',
                  backgroundColor: expandedSections.timing ? 'rgba(108, 92, 231, 0.05)' : 'transparent',
                  transition: 'background-color 0.2s ease',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  border: 'none',
                  textAlign: 'left'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ marginRight: 'var(--spacing-m)', fontSize: '1.2em' }}>⏱️</span>
                  <span style={{ 
                    fontSize: 'var(--font-size-m)',
                    fontWeight: 'bold'
                  }}>
                    Timing Information
                  </span>
                </div>
                <span style={{ 
                  transition: 'transform 0.2s',
                  transform: expandedSections.timing ? 'rotate(180deg)' : 'rotate(0deg)'
                }}>▾</span>
              </button>
              
              {/* Expanded timing details */}
              {expandedSections.timing && (
                <div style={{ 
                  padding: 'var(--spacing-m) var(--spacing-l)',
                  backgroundColor: 'rgba(108, 92, 231, 0.05)'
                }}>
                  <div style={{ 
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'var(--spacing-s)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ marginRight: 'var(--spacing-s)', fontSize: '1em' }}>🕒</span>
                      <span style={{ 
                        fontSize: 'var(--font-size-s)',
                        color: 'var(--base-body-color, #666)'
                      }}>
                        Start Time
                      </span>
                    </div>
                    <span style={{ 
                      fontSize: 'var(--font-size-s)',
                      color: 'var(--base-body-color, #666)'
                    }}>
                      {duplicationStats.startTime > 0 ? new Date(duplicationStats.startTime).toLocaleString() : 'Not available'}
                    </span>
                  </div>
                  
                  <div style={{ 
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'var(--spacing-s)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span style={{ marginRight: 'var(--spacing-s)', fontSize: '1em' }}>⏱️</span>
                      <span style={{ 
                        fontSize: 'var(--font-size-s)',
                        color: 'var(--base-body-color, #666)'
                      }}>
                        End Time
                      </span>
                    </div>
                    <span style={{ 
                      fontSize: 'var(--font-size-s)',
                      color: 'var(--base-body-color, #666)'
                    }}>
                      {duplicationStats.endTime > 0 ? new Date(duplicationStats.endTime).toLocaleString() : 'Not available'}
                    </span>
                  </div>
                  
                  <div style={{ 
                    borderTop: '1px solid var(--border-color, #eee)',
                    paddingTop: 'var(--spacing-s)',
                    marginTop: 'var(--spacing-s)'
                  }}>
                    <div style={{ 
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 'var(--spacing-s)',
                      backgroundColor: 'rgba(108, 92, 231, 0.1)',
                      borderRadius: 'var(--border-radius)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ marginRight: 'var(--spacing-s)', fontSize: '1em' }}>⏳</span>
                        <span style={{ 
                          fontSize: 'var(--font-size-s)',
                          fontWeight: 'bold',
                          color: 'var(--accent-color)'
                        }}>
                          Total Duration
                        </span>
                      </div>
                      <span style={{ 
                        fontSize: 'var(--font-size-s)',
                        fontWeight: 'bold',
                        color: 'var(--accent-color)'
                      }}>
                        {(() => {
                          const ms = duplicationStats.endTime - duplicationStats.startTime;
                          if (ms < 1000) {
                            return `${ms}ms`;
                          }
                          if (ms < 60000) {
                            return `${(ms / 1000).toFixed(1)}s`;
                          }
                          if (ms < 3600000) {
                            const minutes = Math.floor(ms / 60000);
                            const seconds = Math.floor((ms % 60000) / 1000);
                            return `${minutes}m ${seconds}s`;
                          }
                          const hours = Math.floor(ms / 3600000);
                          const minutes = Math.floor((ms % 3600000) / 60000);
                          const seconds = Math.floor((ms % 60000) / 1000);
                          return `${hours}h ${minutes}m ${seconds}s`;
                        })()}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Success Rate */}
            {duplicationStats.totalRecords > 0 && (
              <div style={{
                backgroundColor: duplicationStats.failedRecords > 0 ? 
                  'rgba(255, 153, 0, 0.1)' : 'rgba(0, 198, 107, 0.1)',
                borderRadius: 'var(--border-radius)',
                padding: 'var(--spacing-l)',
                textAlign: 'center',
                marginBottom: 'var(--spacing-l)'
              }}>
                <div style={{ 
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <div style={{ 
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    backgroundColor: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    boxShadow: 'var(--box-shadow-light)',
                    marginBottom: 'var(--spacing-m)'
                  }}>
                    <span style={{
                      fontSize: 'var(--font-size-xxl)',
                      fontWeight: 'bold',
                      color: duplicationStats.failedRecords > 0 ? 
                        'var(--orange-color, #ff9900)' : 'var(--green-color, #00c66b)'
                    }}>
                      {Math.round((duplicationStats.successfulRecords / duplicationStats.totalRecords) * 100)}%
                    </span>
                    <span style={{
                      fontSize: 'var(--font-size-s)',
                      color: 'var(--base-body-color, #555)'
                    }}>Success</span>
                  </div>
                  
                  <span style={{ 
                    fontWeight: 'bold',
                    color: duplicationStats.failedRecords > 0 ? 
                      'var(--orange-color, #ff9900)' : 'var(--green-color, #00c66b)',
                    fontSize: 'var(--font-size-m)',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    {duplicationStats.failedRecords > 0 ? (
                      <>
                        <span style={{ marginRight: 'var(--spacing-s)', fontSize: '1.2em' }}>⚠️</span>
                        Some records failed
                      </>
                    ) : (
                      <>
                        <span style={{ marginRight: 'var(--spacing-s)', fontSize: '1.2em' }}>🎉</span>
                        All records succeeded
                      </>
                    )}
                  </span>
                  
                  {/* Expandable details button */}
                  <button
                    type="button"
                    onClick={() => setExpandedSections({...expandedSections, successRate: !expandedSections.successRate})}
                    aria-expanded={expandedSections.successRate}
                    style={{
                      marginTop: 'var(--spacing-m)',
                      backgroundColor: 'transparent',
                      border: 'none',
                      padding: 'var(--spacing-xs) var(--spacing-s)',
                      borderRadius: 'var(--border-radius)',
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      color: duplicationStats.failedRecords > 0 ? 
                        'var(--orange-color, #ff9900)' : 'var(--green-color, #00c66b)',
                      fontWeight: 'bold'
                    }}
                  >
                    <span>View Details</span>
                    <span style={{
                      marginLeft: 'var(--spacing-xs)',
                      transition: 'transform 0.2s',
                      transform: expandedSections.successRate ? 'rotate(180deg)' : 'rotate(0deg)'
                    }}>▾</span>
                  </button>
                </div>
                
                {/* Expandable details */}
                {expandedSections.successRate && (
                  <div style={{
                    marginTop: 'var(--spacing-m)',
                    textAlign: 'left',
                    padding: 'var(--spacing-m)',
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    borderRadius: 'var(--border-radius)'
                  }}>
                    <h4 style={{ marginBottom: 'var(--spacing-s)' }}>Success By Model</h4>
                    {Object.keys(duplicationStats.modelStats).map(modelId => {
                      const model = duplicationStats.modelStats[modelId];
                      const successRate = model.total === 0 ? 100 : Math.round((model.success / model.total) * 100);
                      return (
                        <div key={modelId} style={{
                          padding: 'var(--spacing-s) 0',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.5)',
                          marginBottom: 'var(--spacing-s)'
                        }}>
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontWeight: 'bold',
                            marginBottom: 'var(--spacing-xs)'
                          }}>
                            <span>{model.name || 'Unnamed Model'}</span>
                            <span style={{
                              color: model.error > 0 ? 'var(--orange-color, #ff9900)' : 'var(--green-color, #00c66b)'
                            }}>{successRate}%</span>
                          </div>
                          
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div style={{ flex: 1, marginRight: 'var(--spacing-s)' }}>
                              <div style={{
                                height: '6px',
                                backgroundColor: 'rgba(255,255,255,0.5)',
                                borderRadius: '3px',
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  height: '100%',
                                  width: `${successRate}%`,
                                  backgroundColor: model.error > 0 ? 
                                    'var(--orange-color, #ff9900)' : 'var(--green-color, #00c66b)',
                                  borderRadius: '3px'
                                }}/>
                              </div>
                            </div>
                            <div style={{ fontSize: 'var(--font-size-s)' }}>
                              {model.success}/{model.total}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </Section>
          
          {/* "Done" button to return to configuration screen */}
          <div style={{ marginTop: 'var(--spacing-xl)' }}>
            <Button
              fullWidth
              buttonType="primary"
              buttonSize="l"
              onClick={() => {
                setShowSummary(false);
                setIsProcessing(false);
                setProgressUpdates([]);
                setDuplicationStats({
                  totalModels: 0,
                  totalRecords: 0,
                  successfulRecords: 0,
                  failedRecords: 0,
                  modelStats: {},
                  startTime: 0,
                  endTime: 0
                });
              }}
            >
              Return to Duplication Screen
            </Button>
          </div>
        </div>
      )}
    </Canvas>
  );
}
