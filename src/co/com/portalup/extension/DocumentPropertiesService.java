package co.com.portalup.extension;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import javax.security.auth.Subject;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.filenet.api.admin.Choice;
import com.filenet.api.admin.ChoiceList;
import com.filenet.api.collection.StringList;
import com.filenet.api.constants.ChoiceType;
import com.filenet.api.constants.PropertyNames;
import com.filenet.api.constants.TypeID;
import com.filenet.api.core.Document;
import com.filenet.api.core.Factory;
import com.filenet.api.core.ObjectStore;
import com.filenet.api.core.VersionSeries;
import com.filenet.api.core.Versionable;
import com.filenet.api.meta.PropertyDescription;
import com.filenet.api.property.FilterElement;
import com.filenet.api.property.Properties;
import com.filenet.api.property.PropertyFilter;
import com.filenet.api.util.Id;
import com.filenet.api.util.UserContext;
import com.ibm.ecm.extension.PluginLogger;
import com.ibm.ecm.extension.PluginService;
import com.ibm.ecm.extension.PluginServiceCallbacks;
import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Propiedades de un documento para "Resultados de consultas" y, si el documento está en S3 (propiedades file_key y
 * storage_name), su contenido en base64, como /portalUpApp/api/documents/properties de la consulta general
 * (DocumentQueryController y S3Service): el contenido se pide al servicio de descarga configurado en el plug-in
 * (PluginConfiguration.S3_DOWNLOAD_URL, GET ?storage_name=…&file_key=… con la cabecera x-api-key) y el navegador lo
 * muestra en el visor.
 *
 * Cuerpo (POST): { documentId }. El documento se lee en el repositorio configurado para el plug-in con la sesión de P8
 * del usuario, así que solo ve lo que él puede ver; storage_name y file_key salen del documento, no de la solicitud.
 *
 * Si file_key es multivalor (documentos de Imagine: un objeto de S3 por página) y el documento está en su versión 1, el
 * contenido no se descarga: se compone con S3Composer y se devuelve composed (URL prefirmada del PDF, que abre el
 * navegador). Si la composición no responde en el timeout configurado, composePending y fileError (sigue en proceso);
 * con { compose: false } en la solicitud no se vuelve a pedir (el navegador ya espera esa composición) y la respuesta es
 * la misma. Desde la versión 2 el PDF compuesto ya está en FileNet y el documento se muestra como cualquier otro (s3
 * false); como la versión 2 tiene otro Id, si se pidió la 1 y la serie ya tiene una liberada posterior, releasedId es la
 * que hay que mostrar.
 *
 * Con { documentId, releasedVersion: true } solo responde { ok: true, data: { id, majorVersion } } de la versión liberada
 * de la serie: el navegador lo pregunta periódicamente mientras espera una composición.
 *
 * Respuesta, siempre HTTP 200: { ok: true, data: { properties: [ { name, label, value } ], s3, mimeType, file, composed:
 * { url, expiresInSeconds, pages, sizeBytes, reused }, composePending, fileError } } (properties en el orden de la
 * clase; file, composed, composePending y fileError solo si s3) o { ok: false, error: { status, code, message } }. Si la
 * descarga o la composición fallan se devuelven las propiedades con fileError.
 */
public class DocumentPropertiesService extends PluginService {

	/** Propiedades de sistema que no se muestran (Constants.SYSTEM_PROPERTIES de la consulta general). */
	static final Set<String> SYSTEM_PROPERTIES = new HashSet<String>(Arrays.asList(
		"Creator", "DateContentLastAccessed", "FoldersFiledIn", "Containers", "IdMultivalor",
		"VersionStatus", "IsReserved", "Reservation", "ReservationType", "PublishingSubsidiaryFolder",
		"IsCurrentVersion", "CurrentVersion", "ReleasedVersion", "CompoundDocumentState",
		"MajorVersionNumber", "MinorVersionNumber", "VersionSeries", "Versions",
		"IsVersioningEnabled", "IsFrozenVersion", "LockToken", "LockOwner", "LockTimeout",
		"SecurityPolicy", "SecurityFolder", "SecurityParent", "Permissions",
		"CanDeclare", "RecordInformation", "CmRetentionDate", "ContentRetentionDate",
		"ContentSize", "ContentElements", "ContentElementsPresent",
		"CurrentState", "Owner", "OwnerDocument", "ParentDocuments", "ChildDocuments",
		"ParentRelationships", "ChildRelationships", "AuditedEvents",
		"WorkflowSubscriptions", "CoordinatedTasks", "ReplicationGroup", "IgnoreRedirect",
		"StorageArea", "StorageLocation", "StoragePolicy", "CmHoldRelationships",
		"This", "Annotations", "DestinationDocuments", "DependentDocuments",
		"CmThumbnails", "CmAcmAssociatedCase", "CmIsMarkedForDeletion",
		"ClassDescription", "ExternalReplicaIdentities", "ClassName", "ActiveMarkings",
		"EntryTemplateId", "EntryTemplateObjectStoreName", "EntryTemplateLaunchedWorkflowNumber",
		"ComponentBindingLabel", "DocumentLifecyclePolicy", "ClbSecurityController", "CmIndexingFailureCode",
		"IsInExceptionState", "DateCheckedIn", "Name", "IdInternet", "LastModifier", "FechaDocumento",
		"TipoComunicado", "IndexationId", "DateLastModified", "Periodo", "ClassificationStatus",
		"SfSalesforceRelationships"));

	static final String FILE_KEY = "file_key";
	static final String STORAGE_NAME = "storage_name";

	private static final Pattern GUID = Pattern.compile("^\\{?[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\\}?$");
	private static final String DATE_PATTERN = "dd/MM/yyyy";
	private static final String COMPOSE_PENDING_MESSAGE =
			"La composición del documento está tomando más tiempo del esperado. Te avisaremos cuando esté disponible.";
	/** Serie de versiones del documento y su versión liberada y actual, para releasedVersion. */
	private static final String VERSION_PROPERTIES = PropertyNames.VERSION_SERIES + " " + PropertyNames.RELEASED_VERSION
			+ " " + PropertyNames.CURRENT_VERSION + " " + PropertyNames.ID + " " + PropertyNames.MAJOR_VERSION_NUMBER;
	private static final int CONNECT_TIMEOUT_MS = 10000;
	private static final int READ_TIMEOUT_MS = 60000;

	/** Propiedad de un documento ya formateada para mostrar. */
	static final class Property {
		final String name;
		final String label;
		final String value;
		/** Valor sin formatear para el tipo MIME y la descarga (texto o List de textos), o null. */
		final Object raw;

		Property(String name, String label, String value, Object raw) {
			this.name = name;
			this.label = label;
			this.value = value;
			this.raw = raw;
		}
	}

	/** Propiedades de un documento y su número de versión mayor. */
	static final class DocumentData {
		final List<Property> properties;
		final int majorVersion;

		DocumentData(List<Property> properties, int majorVersion) {
			this.properties = properties;
			this.majorVersion = majorVersion;
		}
	}

	/** Id y número de versión mayor de una versión de un documento. */
	static final class VersionInfo {
		final String id;
		final int majorVersion;

		VersionInfo(String id, int majorVersion) {
			this.id = id;
			this.majorVersion = majorVersion;
		}
	}

	/** Lee las propiedades de un documento; interfaz para poder probar handle sin ICN ni P8. */
	interface DocumentReader {
		DocumentData read(String documentId) throws Exception;

		/** Versión liberada de la serie de versiones del documento (la actual si no hay liberada). */
		VersionInfo releasedVersion(String documentId) throws Exception;
	}

	/** Descarga de S3 el contenido de un archivo en base64. */
	interface FileDownloader {
		String download(String storageName, String fileKey) throws Exception;
	}

	/** Compone en un PDF los objetos de S3 de un documento (S3Composer). */
	interface DocumentComposer {
		S3Composer.ComposedDocument compose(String storageName, List<String> objects, String documentId) throws Exception;
	}

	public String getId() {
		return "DocumentPropertiesService";
	}

	public void execute(PluginServiceCallbacks callbacks, HttpServletRequest request, HttpServletResponse response)
			throws Exception {
		PluginLogger logger = callbacks.getLogger();
		JSONObject result;
		try {
			JSONObject config = PluginConfiguration.parse(callbacks.loadConfiguration());
			String repositoryId = PluginConfiguration.get(config, PluginConfiguration.REPOSITORY_ID);
			String downloadUrl = PluginConfiguration.get(config, PluginConfiguration.S3_DOWNLOAD_URL);
			String apiKey = PluginConfiguration.get(config, PluginConfiguration.S3_API_KEY);
			result = handle(ExecuteQueriesService.readBody(request),
					repositoryId.length() == 0 ? null : p8Reader(callbacks, repositoryId),
					downloadUrl.length() == 0 ? null : httpDownloader(downloadUrl, apiKey), composer(config, downloadUrl, apiKey));
			Object error = result.get("data") instanceof JSONObject ? ((JSONObject) result.get("data")).get("fileError") : null;
			if (error != null) {
				logger.logWarning(this, "execute", "Contenido S3 no disponible: " + error);
			}
		} catch (Throwable t) {
			// También errores de la JVM, que catch (Exception) no atrapa (ver SettingsService).
			logger.logError(this, "execute", "Error al consultar las propiedades del documento", t);
			result = ExecuteQueriesService.failure(500, "INTERNAL_ERROR",
					"Error inesperado al consultar el documento (" + t.getClass().getName() + ": " + t.getMessage() + ").");
		}
		ExecuteQueriesService.write(response, result);
	}

	/** S3Composer si están configurados el servicio de S3 y las credenciales de Azure; si no, null. */
	private static DocumentComposer composer(JSONObject config, String url, String apiKey) {
		String tokenUrl = PluginConfiguration.get(config, PluginConfiguration.AZURE_TOKEN_URL);
		String clientId = PluginConfiguration.get(config, PluginConfiguration.AZURE_CLIENT_ID);
		String clientSecret = PluginConfiguration.get(config, PluginConfiguration.AZURE_CLIENT_SECRET);
		String resource = PluginConfiguration.get(config, PluginConfiguration.AZURE_RESOURCE);
		if (url.length() == 0 || tokenUrl.length() == 0 || clientId.length() == 0 || clientSecret.length() == 0
				|| resource.length() == 0) {
			return null;
		}
		return new S3Composer(url, apiKey, new AzureTokenProvider(tokenUrl, clientId, clientSecret, resource),
				PluginConfiguration.getComposeTimeoutSeconds(config));
	}

	/**
	 * Lógica del servicio, separada de PluginServiceCallbacks para poder probarla. reader es null sin repositorio,
	 * downloader null si no hay servicio de descarga configurado y composer null si falta el servicio o las credenciales
	 * de Azure.
	 */
	JSONObject handle(String body, DocumentReader reader, FileDownloader downloader, DocumentComposer composer) {
		if (reader == null) {
			return ExecuteQueriesService.failure(400, "REPOSITORY_NOT_CONFIGURED",
					"El plug-in no tiene configurado el repositorio de las consultas.");
		}
		String documentId;
		boolean compose;
		boolean releasedVersionOnly;
		try {
			JSONObject request = JSONObject.parse(body == null ? "" : body);
			Object value = request.get("documentId");
			documentId = value == null ? "" : value.toString().trim();
			compose = !Boolean.FALSE.equals(request.get("compose"));
			releasedVersionOnly = Boolean.TRUE.equals(request.get("releasedVersion"));
		} catch (Exception e) {
			return ExecuteQueriesService.failure(400, "INVALID_REQUEST", "La solicitud no es válida: " + e.getMessage());
		}
		if (!GUID.matcher(documentId).matches()) {
			return ExecuteQueriesService.failure(400, "INVALID_REQUEST", "El id del documento no es válido.");
		}

		if (releasedVersionOnly) {
			VersionInfo released;
			try {
				released = reader.releasedVersion(documentId);
			} catch (Exception e) {
				return ExecuteQueriesService.failure(404, "DOCUMENT_NOT_AVAILABLE",
						"No se pudo leer el documento: " + e.getMessage());
			}
			JSONObject data = new JSONObject();
			data.put("id", released.id);
			data.put("majorVersion", Integer.valueOf(released.majorVersion));
			JSONObject result = new JSONObject();
			result.put("ok", Boolean.TRUE);
			result.put("data", data);
			return result;
		}

		DocumentData document;
		try {
			document = reader.read(documentId);
		} catch (Exception e) {
			return ExecuteQueriesService.failure(404, "DOCUMENT_NOT_AVAILABLE",
					"No se pudo leer el documento: " + e.getMessage());
		}

		JSONArray list = new JSONArray();
		Map<String, Object> raw = new HashMap<String, Object>();
		List<String> fileKeys = null;
		for (Property property : document.properties) {
			JSONObject item = new JSONObject();
			item.put("name", property.name);
			item.put("label", property.label);
			item.put("value", property.value);
			list.add(item);
			if (property.raw instanceof List) {
				// Para el tipo MIME y la detección de S3 basta el primer valor.
				List<String> values = strings((List<?>) property.raw);
				raw.put(property.name, values.isEmpty() ? null : values.get(0));
				if (property.name.equals(FILE_KEY)) {
					fileKeys = values;
				}
			} else {
				raw.put(property.name, property.raw);
			}
		}
		JSONObject data = new JSONObject();
		data.put("properties", list);

		String fileKey = text(raw.get(FILE_KEY));
		String storageName = text(raw.get(STORAGE_NAME));
		boolean s3 = fileKey.length() > 0 && storageName.length() > 0;
		if (s3 && fileKeys != null) {
			// Multivalor: desde la versión 2 el PDF compuesto ya está en FileNet.
			s3 = document.majorVersion <= 1;
			if (s3) {
				// Un resultado de antes de que el workflow creara la versión 2 (el árbol tiene el Id de la 1).
				try {
					VersionInfo released = reader.releasedVersion(documentId);
					if (released.majorVersion > 1) {
						s3 = false;
						data.put("releasedId", released.id);
					}
				} catch (Exception e) {
					// Sin la serie de versiones se compone igual: la Lambda reutiliza la composición si ya existe.
				}
			}
			data.put("s3", Boolean.valueOf(s3));
			if (!s3) {
				data.put("mimeType", DocumentTree.mimeType(raw));
			} else if (!compose) {
				data.put("mimeType", "application/pdf");
				data.put("composePending", Boolean.TRUE);
				data.put("fileError", COMPOSE_PENDING_MESSAGE);
			} else if (composer == null) {
				data.put("mimeType", "application/pdf");
				data.put("fileError",
						"El plug-in no tiene configurado el servicio de composición de documentos (URL de S3 y credenciales de Azure).");
			} else {
				data.put("mimeType", "application/pdf");
				try {
					data.put("composed", composer.compose(storageName, fileKeys, braced(documentId)).toJson());
				} catch (S3Composer.ComposePendingException e) {
					data.put("composePending", Boolean.TRUE);
					data.put("fileError", COMPOSE_PENDING_MESSAGE);
				} catch (Exception e) {
					data.put("fileError", "No fue posible componer el documento (" + storageName + ", " + fileKeys.size()
							+ " objetos): " + e.getMessage());
				}
			}
			JSONObject result = new JSONObject();
			result.put("ok", Boolean.TRUE);
			result.put("data", data);
			return result;
		}
		data.put("s3", Boolean.valueOf(s3));
		data.put("mimeType", DocumentTree.mimeType(raw));
		if (s3) {
			if (downloader == null) {
				data.put("fileError", "El plug-in no tiene configurado el servicio de descarga de S3.");
			} else {
				try {
					data.put("file", downloader.download(storageName, fileKey));
				} catch (Exception e) {
					data.put("fileError", "No fue posible descargar el archivo de S3 (" + storageName + ":" + fileKey + "): "
							+ e.getMessage());
				}
			}
		}

		JSONObject result = new JSONObject();
		result.put("ok", Boolean.TRUE);
		result.put("data", data);
		return result;
	}

	/** Lee el documento en el object store del repositorio con la sesión de P8 del usuario conectado a ICN. */
	private static DocumentReader p8Reader(final PluginServiceCallbacks callbacks, final String repositoryId) {
		return new DocumentReader() {
			public DocumentData read(String documentId) {
				Subject subject = callbacks.getP8Subject(repositoryId);
				ObjectStore objectStore = callbacks.getP8ObjectStore(repositoryId);
				if (subject == null || objectStore == null) {
					throw new IllegalStateException("El usuario no tiene sesión en el repositorio " + repositoryId + ".");
				}
				UserContext userContext = UserContext.get();
				userContext.pushSubject(subject);
				try {
					Document document = Factory.Document.fetchInstance(objectStore, new Id(documentId), null);
					Properties properties = document.getProperties();
					List<Property> result = new ArrayList<Property>();
					Iterator<?> descriptions = document.get_ClassDescription().get_PropertyDescriptions().iterator();
					while (descriptions.hasNext()) {
						PropertyDescription description = (PropertyDescription) descriptions.next();
						String name = description.get_SymbolicName();
						int type = description.get_DataType().getValue();
						// Las de objeto y binarias no se muestran (la consulta general excluye las conocidas por nombre).
						if (SYSTEM_PROPERTIES.contains(name) || type == TypeID.OBJECT_AS_INT || type == TypeID.BINARY_AS_INT
								|| !properties.isPropertyPresent(name)) {
							continue;
						}
						Object value = properties.getObjectValue(name);
						result.add(new Property(name, description.get_DisplayName(),
								format(value, description.get_ChoiceList(), type),
								value instanceof String ? value : value instanceof StringList ? strings((StringList) value) : null));
					}
					Integer majorVersion = document.get_MajorVersionNumber();
					return new DocumentData(result, majorVersion == null ? 0 : majorVersion.intValue());
				} finally {
					userContext.popSubject();
				}
			}

			public VersionInfo releasedVersion(String documentId) {
				Subject subject = callbacks.getP8Subject(repositoryId);
				ObjectStore objectStore = callbacks.getP8ObjectStore(repositoryId);
				if (subject == null || objectStore == null) {
					throw new IllegalStateException("El usuario no tiene sesión en el repositorio " + repositoryId + ".");
				}
				UserContext userContext = UserContext.get();
				userContext.pushSubject(subject);
				try {
					// Documento → VersionSeries → ReleasedVersion/CurrentVersion → Id y MajorVersionNumber, en una sola ida.
					PropertyFilter filter = new PropertyFilter();
					filter.addIncludeProperty(new FilterElement(Integer.valueOf(2), null, null, VERSION_PROPERTIES, null));
					Document document = Factory.Document.fetchInstance(objectStore, new Id(documentId), filter);
					VersionSeries series = document.get_VersionSeries();
					Versionable version = series.get_ReleasedVersion();
					if (version == null) {
						version = series.get_CurrentVersion();
					}
					Document released = (Document) version;
					Integer majorVersion = released.get_MajorVersionNumber();
					return new VersionInfo(released.get_Id().toString(), majorVersion == null ? 0 : majorVersion.intValue());
				} finally {
					userContext.popSubject();
				}
			}
		};
	}

	/**
	 * Valor para mostrar, como FilenetDataTypeFormatter de la consulta general: el nombre visible si la propiedad tiene
	 * lista de opciones, las fechas dd/MM/yyyy y las listas separadas por comas.
	 */
	static String format(Object value, ChoiceList choiceList, int type) {
		if (value == null) {
			return null;
		}
		if (choiceList != null) {
			String display = choiceDisplayName(choiceList.get_ChoiceValues(), value);
			return display != null ? display : value.toString();
		}
		if (type == TypeID.DATE_AS_INT) {
			Date date = value instanceof Calendar ? ((Calendar) value).getTime() : value instanceof Date ? (Date) value : null;
			return date != null ? new SimpleDateFormat(DATE_PATTERN).format(date) : value.toString();
		}
		if (value instanceof StringList || value instanceof java.util.Collection) {
			StringBuilder joined = new StringBuilder();
			for (Object item : (java.util.Collection<?>) value) {
				if (joined.length() > 0) {
					joined.append(", ");
				}
				joined.append(String.valueOf(item));
			}
			return joined.toString();
		}
		return value.toString();
	}

	// Recorre también los grupos anidados de la lista de opciones (también la usa ExecuteQueriesService).
	static String choiceDisplayName(com.filenet.api.collection.ChoiceList choices, Object value) {
		if (choices == null) {
			return null;
		}
		Iterator<?> iterator = choices.iterator();
		while (iterator.hasNext()) {
			Choice choice = (Choice) iterator.next();
			ChoiceType choiceType = choice.get_ChoiceType();
			if (ChoiceType.MIDNODE_STRING.equals(choiceType) || ChoiceType.MIDNODE_INTEGER.equals(choiceType)) {
				String nested = choiceDisplayName(choice.get_ChoiceValues(), value);
				if (nested != null) {
					return nested;
				}
			} else if (ChoiceType.INTEGER.equals(choiceType) ? value.equals(choice.get_ChoiceIntegerValue())
					: value.equals(choice.get_ChoiceStringValue())) {
				return choice.get_DisplayName();
			}
		}
		return null;
	}

	/**
	 * Descarga como S3Service de la consulta general: GET {url}?storage_name=…&file_key=… con la cabecera x-api-key; la
	 * respuesta es el contenido en base64 (si viene como cadena JSON, se le quitan las comillas).
	 */
	static FileDownloader httpDownloader(final String url, final String apiKey) {
		return new FileDownloader() {
			public String download(String storageName, String fileKey) throws IOException {
				String target = url + (url.indexOf('?') < 0 ? "?" : "&") + "storage_name=" + URLEncoder.encode(storageName, "UTF-8")
						+ "&file_key=" + URLEncoder.encode(fileKey, "UTF-8");
				HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
				try {
					connection.setRequestMethod("GET");
					connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
					connection.setReadTimeout(READ_TIMEOUT_MS);
					if (apiKey.length() > 0) {
						connection.setRequestProperty("x-api-key", apiKey);
					}
					int status = connection.getResponseCode();
					if (status < 200 || status >= 300) {
						throw new IOException("HTTP " + status);
					}
					String body = Http.read(connection.getInputStream()).trim();
					if (body.length() >= 2 && body.startsWith("\"") && body.endsWith("\"")) {
						body = body.substring(1, body.length() - 1);
					}
					if (body.length() == 0) {
						throw new IOException("respuesta vacía");
					}
					return body;
				} finally {
					connection.disconnect();
				}
			}
		};
	}

	/** Valores no vacíos, en su orden (el de las páginas en file_key). */
	static List<String> strings(java.util.Collection<?> values) {
		List<String> result = new ArrayList<String>();
		for (Object value : values) {
			String item = text(value);
			if (item.length() > 0) {
				result.add(item);
			}
		}
		return result;
	}

	/** Id con llaves, el formato de Id.toString() de P8 que espera la composición. */
	static String braced(String id) {
		String value = id.toUpperCase();
		return value.startsWith("{") ? value : "{" + value + "}";
	}

	private static String text(Object value) {
		return value == null ? "" : value.toString().trim();
	}
}
