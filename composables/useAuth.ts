import { useState } from "nuxt/app";
import type { User } from "@supabase/supabase-js";

type FacultyProfile = {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
};

type ExaminerProfile = {
  id: string;
  name: string;
};

export const useAuth = () => {
  const user = useState<User | null>("user", () => null);

  // Primary role:
  // admin | faculty | user | examiner | guest
  //
  // "examiner" remains temporarily as a legacy fallback for existing
  // examiner accounts that have not yet been added to faculty.
  const role = useState<string>("role", () => "guest");

  // Faculty is a staff identity/capability.
  const isFaculty = useState<boolean>("isFaculty", () => false);

  const facultyProfile = useState<FacultyProfile | null>(
    "facultyProfile",
    () => null,
  );

  // Examiner is an independent capability.
  // A faculty member may also be an examiner.
  const isExaminer = useState<boolean>("isExaminer", () => false);

  const examinerProfile = useState<ExaminerProfile | null>(
    "examinerProfile",
    () => null,
  );

  const supabase = useSupabaseClient();
  const supabaseUser = useSupabaseUser();

  const resetAuthState = () => {
    user.value = null;
    role.value = "guest";
    isFaculty.value = false;
    facultyProfile.value = null;
    isExaminer.value = false;
    examinerProfile.value = null;
  };

  const getUser = async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      resetAuthState();
      return null;
    }

    user.value = data.user;

    const email = (data.user.email || "").toLowerCase();

    // Admin, Faculty and Examiner are checked independently.
    //
    // This allows:
    // - admin only
    // - faculty only
    // - faculty + examiner
    // - admin + examiner
    // - admin + faculty
    // - admin + faculty + examiner
    const [adminResult, facultyResult, examinerResult] = await Promise.all([
      supabase
        .from("admin")
        .select("email")
        .eq("email", data.user.email)
        .maybeSingle(),

      supabase
        .from("faculty")
        .select("id, name, email, is_active")
        .eq("email", email)
        .eq("is_active", true)
        .maybeSingle(),

      supabase
        .from("examiners")
        .select("id, name")
        .eq("email", email)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    const isAdminUser = Boolean(adminResult.data && !adminResult.error);

    const facultyRecord =
      facultyResult.data && !facultyResult.error ? facultyResult.data : null;

    const examinerRecord =
      examinerResult.data && !examinerResult.error ? examinerResult.data : null;

    isFaculty.value = Boolean(facultyRecord);

    facultyProfile.value = facultyRecord
      ? {
          id: facultyRecord.id,
          name: facultyRecord.name,
          email: facultyRecord.email,
          is_active: facultyRecord.is_active,
        }
      : null;

    isExaminer.value = Boolean(examinerRecord);

    examinerProfile.value = examinerRecord
      ? {
          id: examinerRecord.id,
          name: examinerRecord.name,
        }
      : null;

    // Primary role.
    //
    // Admin always remains admin.
    // Otherwise a Faculty member is faculty.
    // Examiner-only accounts remain temporarily supported.
    if (isAdminUser) {
      role.value = "admin";
    } else if (facultyRecord) {
      role.value = "faculty";
    } else if (examinerRecord) {
      // Temporary compatibility for existing examiner accounts.
      role.value = "examiner";
    } else {
      role.value = "user";
    }

    return data.user;
  };

  const signInWithGoogle = async () => {
    const redirectUrl = `${window.location.origin}/auth/confirm`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: "https://www.googleapis.com/auth/calendar.readonly",
        redirectTo: redirectUrl,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      return { data: null, error };
    }

    return {
      data,
      error: null,
    };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (!error) {
      resetAuthState();
    }

    return { error };
  };

  watch(
    supabaseUser,
    (newUser) => {
      user.value = newUser;

      if (!newUser) {
        resetAuthState();
      }
    },
    {
      immediate: true,
    },
  );

  const isAdmin = () => role.value === "admin";

  const isFacultyUser = () => isFaculty.value;

  const isUser = () => role.value === "user";

  const isAuthenticated = () => !!user.value;

  const isExaminerUser = () => isExaminer.value;

  return {
    user,
    role,

    isFaculty,
    facultyProfile,

    isExaminer,
    examinerProfile,

    getUser,
    signInWithGoogle,
    signOut,

    isAdmin,
    isFacultyUser,
    isUser,
    isAuthenticated,
    isExaminerUser,
  };
};
