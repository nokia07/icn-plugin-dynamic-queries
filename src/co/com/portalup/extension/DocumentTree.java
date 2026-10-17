package co.com.portalup.extension;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Árbol de resultados de "Resultados de consultas", armado como DocumentTreeBuilder de la consulta general
 * (Prote_ConsGral, /portalUpApp/api/documents/queryContent): cada consulta agrupa sus documentos en las carpetas
 * virtuales de su config (DSCONFIG de CG_CFG_QUERY, aquí la config de la asociación proyecto–consulta) y las carpetas
 * con el mismo nombre en el mismo nivel se fusionan. La respuesta tiene la misma forma, la que lee
 * DQResults.buildTreeData: [ { text, type: "Virtual", index, data, children: [ carpeta | documento ] } ].
 *
 * Sin dependencias de P8 ni de ICN, para poder probarla fuera del servidor.
 */
final class DocumentTree {

	/** Documento encontrado por una consulta; properties trae las de LABEL_PROPERTIES que tenga la clase. */
	static final class Result {
		final String objectStore;
		final String id;
		final List<String> path;
		final Map<String, Object> properties;

		Result(String objectStore, String id, List<String> path, Map<String, Object> properties) {
			this.objectStore = objectStore;
			this.id = id;
			this.path = path;
			this.properties = properties;
		}
	}

	/** Propiedades que usa el árbol (rótulo y tipo MIME); las que la clase no tiene simplemente no vienen. */
	static final String[] LABEL_PROPERTIES = {
		"DocumentTitle", "MimeType", "RadicadoProteccion", "TipoDocumento", "file_key", "storage_name"
	};

	private static final Pattern VN_ROOT_STRING = Pattern.compile("vnRoot\\s*:\\s*\"([^\"]*)\"");
	private static final Pattern VN_ROOT_NAME = Pattern.compile("name\\s*:\\s*\"([^\"]*)\"");
	private static final Pattern EXTENSION = Pattern.compile("\\.([a-zA-Z0-9]+)$");

	private int index;

	private DocumentTree() {
	}

	/**
	 * Carpetas de una config, en los dos formatos que acepta la consulta general: { vnRoot: "A,B,C" } (una sola
	 * carpeta con comas en el nombre, que el cliente separa en carpetas anidadas) o { vnRoot: [ { name: "A" }, ... ] }
	 * (una carpeta por elemento). No es JSON (las claves no van entre comillas), así que se lee con expresiones
	 * regulares, igual que DocumentTreeBuilder.parseConfigMap. Sin vnRoot devuelve una lista vacía.
	 */
	static List<String> parseConfig(String config) {
		List<String> path = new ArrayList<String>();
		if (config == null) {
			return path;
		}
		if (config.contains("[") && config.contains("name")) {
			Matcher names = VN_ROOT_NAME.matcher(config);
			while (names.find()) {
				addFolder(path, names.group(1));
			}
		} else {
			Matcher root = VN_ROOT_STRING.matcher(config);
			if (root.find()) {
				addFolder(path, root.group(1));
			}
		}
		return path;
	}

	/** Árbol de los resultados, en el orden de las consultas y de los documentos de cada una. */
	static JSONArray build(List<Result> results) {
		DocumentTree tree = new DocumentTree();
		JSONArray root = new JSONArray();
		for (Result result : results) {
			if (result.path.isEmpty()) {
				// Igual que la consulta general: sin carpeta configurada el documento no se muestra.
				continue;
			}
			JSONArray level = root;
			JSONObject folder = null;
			for (String name : result.path) {
				folder = tree.findOrCreateFolder(level, name);
				level = (JSONArray) folder.get("children");
			}
			level.add(tree.documentNode(result));
		}
		return root;
	}

	private static void addFolder(List<String> path, String name) {
		String trimmed = name.trim();
		if (trimmed.length() > 0) {
			path.add(trimmed);
		}
	}

	private JSONObject findOrCreateFolder(JSONArray level, String name) {
		for (Object node : level) {
			JSONObject existing = (JSONObject) node;
			if ("Virtual".equals(existing.get("type")) && name.equals(existing.get("text"))) {
				return existing;
			}
		}
		JSONObject folder = new JSONObject();
		folder.put("text", name);
		folder.put("type", "Virtual");
		folder.put("index", Long.valueOf(index++));
		folder.put("data", new JSONObject());
		folder.put("children", new JSONArray());
		level.add(folder);
		return folder;
	}

	private JSONObject documentNode(Result result) {
		String mimeType = mimeType(result.properties);
		JSONObject data = new JSONObject();
		data.put("objectStoreName", result.objectStore);
		data.put("objId", result.id);

		JSONObject node = new JSONObject();
		node.put("text", label(result.properties));
		node.put("type", "Document");
		node.put("index", Long.valueOf(index++));
		node.put("leaf", Boolean.TRUE);
		node.put("expanded", Boolean.TRUE);
		node.put("forceIcnViewer", Boolean.TRUE);
		node.put("iconCls", iconCls(mimeType));
		node.put("mimeType", mimeType);
		node.put("icnRepoId", result.objectStore);
		node.put("path", result.objectStore + ":/" + result.id);
		node.put("data", data);
		node.put("viewerUrl", "/navigator/bookmark.jsp?desktop=LPADocViewer&feature=BookmarkLayout&repositoryId="
				+ result.objectStore + "&repositoryType=p8&docid=" + result.id + "&objectType=document&objectStoreName="
				+ result.objectStore);
		return node;
	}

	/**
	 * "Tipo [Radicado sin extensión | Título]", como la consulta general. Allí el tipo es la descripción de
	 * TAP8_PRO_TIPOS_DOC (tabla de Oracle de esa aplicación); aquí es el valor de TipoDocumento. Si la clase no tiene
	 * TipoDocumento, solo la parte entre corchetes, sin ellos.
	 */
	static String label(Map<String, Object> properties) {
		String title = text(properties, "DocumentTitle");
		String radicado = text(properties, "RadicadoProteccion");
		String documentType = text(properties, "TipoDocumento");
		String name = !radicado.isEmpty() ? radicado.replaceAll("\\..*", "") : (!title.isEmpty() ? title : "Documento sin título");
		return documentType.isEmpty() ? name : documentType + " [" + name + "]";
	}

	/** MimeType o, para los documentos en S3 (file_key y storage_name), el de la extensión del título o de file_key. */
	static String mimeType(Map<String, Object> properties) {
		String mimeType = text(properties, "MimeType");
		String fileKey = text(properties, "file_key");
		if (!mimeType.isEmpty() || fileKey.isEmpty() || text(properties, "storage_name").isEmpty()) {
			return mimeType.isEmpty() ? null : mimeType;
		}
		Matcher extension = EXTENSION.matcher(text(properties, "DocumentTitle"));
		if (!extension.find()) {
			extension = EXTENSION.matcher(fileKey.substring(fileKey.lastIndexOf('/') + 1));
			if (!extension.find()) {
				return "application/octet-stream";
			}
		}
		String ext = extension.group(1).toLowerCase();
		if (ext.equals("pdf")) {
			return "application/pdf";
		} else if (ext.equals("doc") || ext.equals("docx")) {
			return "application/msword";
		} else if (ext.equals("xls") || ext.equals("xlsx")) {
			return "application/ms-excel";
		} else if (ext.equals("jpg") || ext.equals("jpeg")) {
			return "image/jpeg";
		} else if (ext.equals("png")) {
			return "image/png";
		} else if (ext.equals("txt")) {
			return "text/plain";
		} else if (ext.equals("tif") || ext.equals("tiff")) {
			return "image/tiff";
		}
		return "application/octet-stream";
	}

	private static String iconCls(String mimeType) {
		if (mimeType == null) {
			return "Document";
		} else if (mimeType.contains("pdf")) {
			return "mime_pdf";
		} else if (mimeType.contains("ms-excel")) {
			return "mime_xls";
		} else if (mimeType.contains("word") || mimeType.contains("wordprocessingml")) {
			return "mime_doc";
		} else if (mimeType.contains("image/tiff")) {
			return "mime_tif";
		} else if (mimeType.contains("image/jpeg")) {
			return "mime_jpg";
		} else if (mimeType.contains("text/plain")) {
			return "mime_txt";
		}
		return "Document";
	}

	private static String text(Map<String, Object> properties, String name) {
		Object value = properties.get(name);
		return value == null ? "" : value.toString().trim();
	}
}
