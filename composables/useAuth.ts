import { useState } from "nuxt/app";
import type { User } from "@supabase/supabase-js";

type Role = "admin" | "faculty" | "examiner" | "user" | "guest";

type FacultyProfile = {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  staff_type: "teaching" | "non_teaching";
};

type ExaminerProfile = {
  id: string;
  name: string;
};

export const useAuth = () => {
  const user = useState<User | null>("user", () => null);

  /*
   * The dashboards/capabilities this user can switch between.
   *
   * Examples:
   *   Faculty only             -> ["faculty"]
   *   Faculty + Admin          -> ["admin", "faculty"]
   *   Faculty + Examiner       -> ["faculty", "examiner"]
   *   Faculty + Admin + Exam.  -> ["admin", "faculty", "examiner"]
   *   Student only             -> ["user"]
   */
  const availableRoles = useState<Role[]>("availableRoles", () => []);

  /*
   * The dashboard the user is currently using.
   *
   * This is a UI/navigation state.
   * Backend authorization remains based on the actual database records.
   */
  const activeRole = useState<Role>("activeRole", () => "guest");

  /*
   * Backwards-compatible alias.
   *
   * Existing middleware already uses role.value.
   * It now represents the currently selected dashboard.
   */
  const role = activeRole;

  const isFaculty = useState<boolean>("isFaculty", () => false);

  const facultyProfile = useState<FacultyProfile | null>(
    "facultyProfile",
    () => null,
  );

  const isExaminer = useState<boolean>("isExaminer", () => false);

  const examinerProfile = useState<ExaminerProfile | null>(
    "examinerProfile",
    () => null,
  );

  const supabase = useSupabaseClient();
  const supabaseUser = useSupabaseUser();

  const resetAuthState = () => {
    user.value = null;
    availableRoles.value = [];
    activeRole.value = "guest";
    isFaculty.value = false;
    facultyProfile.value = null;
    isExaminer.value = false;
    examinerProfile.value = null;
  };

  const setActiveRole = (newRole: Role) => {
    if (availableRoles.value.includes(newRole)) {
      activeRole.value = newRole;
    }
  };

  const getUser = async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      resetAuthState();
      return null;
    }

    user.value = data.user;

    const email = (data.user.email || "").toLowerCase();

    const [adminResult, facultyResult, examinerResult] = await Promise.all([
      supabase
        .from("admin")
        .select("email")
        .eq("email", data.user.email)
        .maybeSingle(),

      supabase
        .from("faculty")
        .select("id, name, email, is_active, staff_type")
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

    /*
     * Faculty is the base staff membership.
     */
    isFaculty.value = Boolean(facultyRecord);

    facultyProfile.value = facultyRecord
      ? {
          id: facultyRecord.id,
          name: facultyRecord.name,
          email: facultyRecord.email,
          is_active: facultyRecord.is_active,
          staff_type: facultyRecord.staff_type,
        }
      : null;

    /*
     * Examiner is only a valid capability for:
     *
     *   Faculty
     *   +
     *   Teaching staff
     *   +
     *   active examiner record
     */
    const isTeachingFaculty = facultyRecord?.staff_type === "teaching";

    const isValidExaminer =
      Boolean(examinerRecord) && Boolean(facultyRecord) && isTeachingFaculty;

    isExaminer.value = isValidExaminer;

    examinerProfile.value =
      isValidExaminer && examinerRecord
        ? {
            id: examinerRecord.id,
            name: examinerRecord.name,
          }
        : null;

    /*
     * Build available dashboards.
     *
     * Admin and Examiner are capabilities layered on top
     * of the Faculty membership.
     */
    const roles: Role[] = [];

    if (isAdminUser) {
      roles.push("admin");
    }

    if (facultyRecord) {
      roles.push("faculty");
    }

    if (isValidExaminer) {
      roles.push("examiner");
    }

    /*
     * If the account has no Faculty/Admin/Examiner access,
     * it remains an ordinary student/user.
     */
    if (roles.length === 0) {
      roles.push("user");
    }

    availableRoles.value = roles;

    /*
     * Preserve the currently selected dashboard if it is still
     * available. Otherwise use the first available dashboard.
     *
     * Admin is intentionally first when available, preserving
     * the existing behavior for Henry.
     */
    if (!availableRoles.value.includes(activeRole.value)) {
      activeRole.value = availableRoles.value[0];
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

  const isAdmin = () => activeRole.value === "admin";
  const isFacultyUser = () => isFaculty.value;
  const isUser = () => activeRole.value === "user";
  const isAuthenticated = () => !!user.value;
  const isExaminerUser = () => isExaminer.value;

  return {
    user,

    // Dashboard switching
    role,
    activeRole,
    availableRoles,
    setActiveRole,

    // Faculty
    isFaculty,
    facultyProfile,

    // Examiner capability
    isExaminer,
    examinerProfile,

    // Authentication
    getUser,
    signInWithGoogle,
    signOut,

    // Helpers
    isAdmin,
    isFacultyUser,
    isUser,
    isAuthenticated,
    isExaminerUser,
  };
};
