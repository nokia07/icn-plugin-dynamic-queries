package co.com.portalup.extension;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
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
import com.filenet.api.constants.TypeID;
import com.filenet.api.core.Document;
import com.filenet.api.core.Factory;
import com.filenet.api.core.ObjectStore;
import com.filenet.api.meta.PropertyDescription;
import com.filenet.api.property.Properties;
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
 * Respuesta, siempre HTTP 200: { ok: true, data: { properties: [ { name, label, value } ], s3, mimeType, file,
 * fileError } } (properties en el orden de la clase; file y fileError solo si s3) o { ok: false, error: { status, code,
 * message } }. Si la descarga falla se devuelven las propiedades con fileError.
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
	private static final int CONNECT_TIMEOUT_MS = 10000;
	private static final int READ_TIMEOUT_MS = 60000;

	/** Propiedad de un documento ya formateada para mostrar. */
	static final class Property {
		final String name;
		final String label;
		final String value;
		/** Valor sin formatear para el tipo MIME y la descarga (texto), o null. */
		final Object raw;

		Property(String name, String label, String value, Object raw) {
			this.name = name;
			this.label = label;
			this.value = value;
			this.raw = raw;
		}
	}

	/** Lee las propiedades de un documento; interfaz para poder probar handle sin ICN ni P8. */
	interface DocumentReader {
		List<Property> read(String documentId) throws Exception;
	}

	/** Descarga de S3 el contenido de un archivo en base64. */
	interface FileDownloader {
		String download(String storageName, String fileKey) throws Exception;
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
			result = handle(ExecuteQueriesService.readBody(request),
					repositoryId.length() == 0 ? null : p8Reader(callbacks, repositoryId),
					downloadUrl.length() == 0 ? null
							: httpDownloader(downloadUrl, PluginConfiguration.get(config, PluginConfiguration.S3_API_KEY)));
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

	/**
	 * Lógica del servicio, separada de PluginServiceCallbacks para poder probarla. reader es null sin repositorio y
	 * downloader null si no hay servicio de descarga configurado.
	 */
	JSONObject handle(String body, DocumentReader reader, FileDownloader downloader) {
		if (reader == null) {
			return ExecuteQueriesService.failure(400, "REPOSITORY_NOT_CONFIGURED",
					"El plug-in no tiene configurado el repositorio de las consultas.");
		}
		String documentId;
		try {
			Object value = JSONObject.parse(body == null ? "" : body).get("documentId");
			documentId = value == null ? "" : value.toString().trim();
		} catch (Exception e) {
			return ExecuteQueriesService.failure(400, "INVALID_REQUEST", "La solicitud no es válida: " + e.getMessage());
		}
		if (!GUID.matcher(documentId).matches()) {
			return ExecuteQueriesService.failure(400, "INVALID_REQUEST", "El id del documento no es válido.");
		}

		List<Property> properties;
		try {
			properties = reader.read(documentId);
		} catch (Exception e) {
			return ExecuteQueriesService.failure(404, "DOCUMENT_NOT_AVAILABLE",
					"No se pudo leer el documento: " + e.getMessage());
		}

		JSONArray list = new JSONArray();
		Map<String, Object> raw = new HashMap<String, Object>();
		for (Property property : properties) {
			JSONObject item = new JSONObject();
			item.put("name", property.name);
			item.put("label", property.label);
			item.put("value", property.value);
			list.add(item);
			raw.put(property.name, property.raw);
		}
		JSONObject data = new JSONObject();
		data.put("properties", list);

		String fileKey = text(raw.get(FILE_KEY));
		String storageName = text(raw.get(STORAGE_NAME));
		boolean s3 = fileKey.length() > 0 && storageName.length() > 0;
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
			public List<Property> read(String documentId) {
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
								format(value, description.get_ChoiceList(), type), value instanceof String ? value : null));
					}
					return result;
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
					String body = read(connection.getInputStream()).trim();
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

	private static String read(InputStream input) throws IOException {
		try {
			ByteArrayOutputStream output = new ByteArrayOutputStream();
			byte[] buffer = new byte[8192];
			int read;
			while ((read = input.read(buffer)) != -1) {
				output.write(buffer, 0, read);
			}
			return output.toString("UTF-8");
		} finally {
			input.close();
		}
	}

	private static String text(Object value) {
		return value == null ? "" : value.toString().trim();
	}
}
