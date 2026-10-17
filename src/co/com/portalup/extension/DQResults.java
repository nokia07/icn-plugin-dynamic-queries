package co.com.portalup.extension;

import java.util.Locale;

import com.ibm.ecm.extension.PluginFeature;

/**
 * Feature "Resultados de consultas" (dynamicQueriesDojo.DQResults): el usuario elige un proyecto del microservicio de DQ,
 * llena los comodines de sus consultas y las ejecuta (ExecuteQueriesService); los documentos se muestran agrupados en
 * carpetas como en la consulta general, con sus propiedades y el visor de GQViewFeature (PortalUpICN).
 */
public class DQResults extends PluginFeature {

	/** Se usa en URL: solo caracteres alfanuméricos. */
	public String getId() {
		return "DQResults";
	}

	public String getName(Locale locale) {
		return "Resultados de consultas";
	}

	public String getDescription(Locale locale) {
		return "Muestra los documentos encontrados, sus propiedades y el visor.";
	}

	/** Clase CSS del icono, definida en DynamicQueries.css. */
	public String getIconUrl() {
		return "DQResultsLaunchIcon";
	}

	public String getSvgFilePath() {
		return "";
	}

	public String getHelpContext() {
		return null;
	}

	public String getFeatureIconTooltipText(Locale locale) {
		return "Resultados de consultas";
	}

	public String getPopupWindowTooltipText(Locale locale) {
		return "";
	}

	public String getContentClass() {
		return "dynamicQueriesDojo.DQResults";
	}

	public boolean isSeparator() {
		return false;
	}

	public String getPopupWindowClass() {
		return "";
	}

	public boolean isPreLoad() {
		return false;
	}

	public String getConfigurationDijitClass() {
		return "dynamicQueriesDojo.FeatureConfigurationPane";
	}
}
