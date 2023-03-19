package org.trailcatalog.importers.elevation.contour;

import com.google.devtools.build.runfiles.AutoBazelRepository;
import java.io.IOException;
import org.trailcatalog.common.IORuntimeException;

@AutoBazelRepository
public class Runfiles {

  private static final com.google.devtools.build.runfiles.Runfiles delegate;

  public static String rlocation(String path) {
    return delegate.rlocation(path);
  }

  static {
    try {
      delegate =
          com.google.devtools.build.runfiles.Runfiles.preload()
              .withSourceRepository(AutoBazelRepository_Runfiles.NAME);
    } catch (IOException e) {
      throw new IORuntimeException("Unable to load runfiles", e);
    }
  }
}
