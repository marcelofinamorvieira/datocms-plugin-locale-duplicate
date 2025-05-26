import { connect,  Field, OverrideFieldExtensionsCtx } from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";
import ConfigScreen from "./entrypoints/ConfigScreen";
import SettingsAreaSidebar from "./entrypoints/SettingsAreaSidebar";
import FieldExtension from "./entrypoints/FieldExtension";
import { render } from "./utils/render";

connect({
	renderConfigScreen(ctx) {
		return render(<ConfigScreen ctx={ctx} />);
	},
	settingsAreaSidebarItemGroups() {
		return [
			{
				label: 'Locale Duplicate',
				items: [
					{
						label: 'Mass Locale Duplication',
						icon: 'copy',
						pointsTo: {
							pageId: 'massLocaleDuplication',
						},
					},
				],
			},
		];
	},
	renderPage(pageId, ctx) {
		switch (pageId) {
			case 'massLocaleDuplication':
				return render(<SettingsAreaSidebar ctx={ctx} />);
		}
	},
	overrideFieldExtensions(field: Field, ctx: OverrideFieldExtensionsCtx) {
		interface FieldConfig {
			modelId: string;
			modelLabel: string;
			fieldId: string;
			fieldLabel: string;
		}
		
		const configs = ctx.plugin.attributes.parameters?.fieldConfigs as FieldConfig[] | undefined;
		
		// Check if there are any configurations
		if (!configs || !Array.isArray(configs)) {
			return;
		}
		
		// Check if this specific field is configured for this model
		const isConfigured = configs.some(
			config => config.modelId === ctx.itemType.id && config.fieldId === field.id
		);
		
		if (isConfigured) {
			return {
				addons: [{ id: 'localeCopyButton' }],
			};
		}
	},
	renderFieldExtension(fieldExtensionId, ctx) {
		if (fieldExtensionId === 'localeCopyButton') {
			return render(<FieldExtension ctx={ctx} />);
		}
	},
});
