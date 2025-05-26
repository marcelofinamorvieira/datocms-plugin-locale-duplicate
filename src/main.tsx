import { connect } from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";
import ConfigScreen from "./entrypoints/ConfigScreen";
import SettingsAreaSidebar from "./entrypoints/SettingsAreaSidebar";
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
});
