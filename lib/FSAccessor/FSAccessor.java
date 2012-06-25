import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.Date;
import java.security.AccessController;
import java.security.PrivilegedAction;

/* XXX use asynchronous IO if possible */

public class FSAccessor extends java.applet.Applet {
    public String read(final String filename) {
        return (String)AccessController.doPrivileged(new PrivilegedAction() {
            public Object run() {               
                try {
                    File f = new File(filename);
                    FileInputStream i = new FileInputStream(f);
                    byte[] b = new byte[(f.length() > Integer.MAX_VALUE) ? Integer.MAX_VALUE : (int)f.length()];
                    int offset = 0;
                    int num = 0;
                    while (offset < b.length && (num = i.read(b, offset, b.length - offset)) >= 0) {
                        offset += num;
                    }
                    i.close();
                    return new String(b, 0, offset, "UTF-8");
                } catch (Exception x) {
                    x.printStackTrace();
                    return null;
                }
            }
        });
    }
    public int write(final String filename, final String data) {
        return ((Integer)AccessController.doPrivileged(new PrivilegedAction() {
            public Object run() {             
                try {
                    File dir = (new File(filename)).getParentFile();
                    if (dir != null && !dir.exists()) {
                        dir.mkdirs();
                    }

                    FileOutputStream o = new FileOutputStream(filename);
                    o.write(data.getBytes("UTF-8"));
                    o.close();
                    return new Integer(1);
                } catch (Exception x) {
                    x.printStackTrace();
                    return new Integer(-1);
                }
            }
        })).intValue();
    }
    public int exists(final String filename) {
        return (Integer)AccessController.doPrivileged(new PrivilegedAction() {
            public Object run() {               
                try {
                    File f = new File(filename);
                    if (f.exists()) {
                        return new Integer(1);
                    } else {
                        return new Integer(0);
                    }
                } catch (Exception x) {
                    x.printStackTrace();
                    return new Integer(-1);
                }
            }
        });
    }
    /* it is very inefficient to return Java arrays (element access from
     * javascript seems to call Java functions again), so we return an encoded
     * version of the array  */
    public String list(final String pathname, final boolean create) {
        return (String)AccessController.doPrivileged(new PrivilegedAction() {
            public Object run() {               
                try {
                    File f = new File(pathname);
                    if (!f.exists() && create) {
                        f.mkdirs();
                    }
                    String[] files = f.list();
                    String fileList = "";
                    for (int i = 0; i < files.length; i ++) {
                        fileList += files[i].replace("\\", "\\b").replace(",", "\\c");
                        if (i < files.length - 1)
                            fileList += ",";
                    }
                    return fileList;
                } catch (Exception x) {
                    x.printStackTrace();
                    return null;
                }
            }
        });
    }
    public long acquireLock(final String pathname) {
        return (Long)AccessController.doPrivileged(new PrivilegedAction() {
            public Object run() {               
                try {
                    File f = new File(pathname);
                    File parent = f.getParentFile();
                    if (parent != null && !parent.exists()) {
                        parent.mkdirs();
                    }
                    if (f.createNewFile()) {
                        return new Long(1);
                    } else {
                        long age = (new Date()).getTime() - f.lastModified();
                        return new Long(-age);
                    }
                } catch (Exception x) {
                    x.printStackTrace();
                    return new Long(0);
                }
            }
        });
    }
    public int releaseLock(final String pathname) {
        return (Integer)AccessController.doPrivileged(new PrivilegedAction() {
            public Object run() {               
                try {
                    File f = new File(pathname);
                    if (f.delete()) {
                        return new Integer(1);
                    } else {
                        return new Integer(2);
                    }
                } catch (Exception x) {
                    x.printStackTrace();
                    return new Integer(0);
                }
            }
        });
    }
}
