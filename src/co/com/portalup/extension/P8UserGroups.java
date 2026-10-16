package co.com.portalup.extension;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import javax.security.auth.Subject;

import com.filenet.api.core.Connection;
import com.filenet.api.core.Factory;
import com.filenet.api.security.Group;
import com.filenet.api.security.User;
import com.filenet.api.util.UserContext;
import com.ibm.ecm.extension.PluginServiceCallbacks;

/**
 * Grupos de P8 del usuario conectado a ICN, leídos del Content Engine con su propia sesión (User.MemberOfGroups).
 * Necesita Jace.jar solo para compilar: en ICN ya está en el classpath, no se empaqueta en el plug-in.
 */
final class P8UserGroups {

	private P8UserGroups() {
	}

	/**
	 * Nombres de los grupos del usuario en el repositorio (ShortName, Name y DistinguishedName de cada uno, para que el
	 * administrador pueda configurar cualquiera de ellos). Falla si el usuario no tiene sesión en ese repositorio.
	 */
	static List<String> fetch(PluginServiceCallbacks callbacks, String repositoryId) {
		Subject subject = callbacks.getP8Subject(repositoryId);
		Connection connection = callbacks.getP8Connection(repositoryId);
		if (subject == null || connection == null) {
			throw new IllegalStateException("El usuario no tiene sesión en el repositorio " + repositoryId + ".");
		}
		UserContext userContext = UserContext.get();
		userContext.pushSubject(subject);
		try {
			User user = Factory.User.fetchCurrent(connection, null);
			List<String> names = new ArrayList<String>();
			Iterator<?> groups = user.get_MemberOfGroups().iterator();
			while (groups.hasNext()) {
				Group group = (Group) groups.next();
				addName(names, group.get_ShortName());
				addName(names, group.get_Name());
				addName(names, group.get_DistinguishedName());
			}
			return names;
		} finally {
			userContext.popSubject();
		}
	}

	private static void addName(List<String> names, String name) {
		if (name != null && name.trim().length() > 0) {
			names.add(name.trim());
		}
	}
}
