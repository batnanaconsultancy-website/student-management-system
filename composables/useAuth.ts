import { useState } from "nuxt/app"
import type { User } from "@supabase/supabase-js"

export const useAuth = () => {
    // Use useState to create a global reactive user state (like in the tutorial)
    const user = useState<User | null>('user', () => null)
    // Add role state to track user's role (admin or user)
    const role = useState<string>('role', () => 'guest')

    // Examiner is an INDEPENDENT capability, not a replacement for
    // role above -- someone can be role='admin' (or role='user', for a
    // student who happens to also be an examiner... though in
    // practice examiners are usually staff) AND isExaminer=true at
    // the same time. A person who is ONLY an examiner (not in the
    // admin table) gets role='examiner' so they don't fall through
    // into student-only pages that assume every 'user' has a student
    // record. See migrations/2026-10-01-create-final-project-assessment-tables.sql.
    const isExaminer = useState<boolean>('isExaminer', () => false)
    const examinerProfile = useState<{ id: string; name: string } | null>('examinerProfile', () => null)

    // Get the Supabase client from @nuxtjs/supabase module
    const supabase = useSupabaseClient()    // Also get the built-in user state for comparison/fallback
    const supabaseUser = useSupabaseUser()

    const getUser = async () => {
        const { data, error } = await supabase.auth.getUser()

        if (error) {
            user.value = null
            role.value = 'guest'
            isExaminer.value = false
            examinerProfile.value = null
            return null
        }

        if (data.user) {
            user.value = data.user

            // Check admin status and examiner status in parallel --
            // these are independent, not mutually exclusive.
            const [adminResult, examinerResult] = await Promise.all([
                supabase.from("admin").select("email").eq("email", data.user.email).maybeSingle(),
                supabase.from("examiners").select("id, name").eq("email", data.user.email?.toLowerCase()).eq("is_active", true).maybeSingle(),
            ])

            const isAdminUser = Boolean(adminResult.data && !adminResult.error)
            const examinerRecord = examinerResult.data && !examinerResult.error ? examinerResult.data : null

            isExaminer.value = Boolean(examinerRecord)
            examinerProfile.value = examinerRecord ? { id: examinerRecord.id, name: examinerRecord.name } : null

            if (isAdminUser) {
                role.value = 'admin'
            } else if (examinerRecord) {
                // Pure examiner: not an admin, and not assumed to have a
                // student record either -- gets their own role so they
                // land on an examiner-specific area instead of the
                // student dashboard.
                role.value = 'examiner'
            } else {
                role.value = 'user'
            }
        } else {
            user.value = null
            role.value = 'guest'
            isExaminer.value = false
            examinerProfile.value = null
        }

        return data.user
    }

    const signInWithGoogle = async () => {
        // Get the current origin to make redirect URL dynamic
        const redirectUrl = `${window.location.origin}/auth/confirm`

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                scopes: "https://www.googleapis.com/auth/calendar.readonly",
                redirectTo: redirectUrl,
                queryParams: { access_type: "offline", prompt: "consent" },
            },
        })

        if (error) {
            return { data: null, error }
        }

        return { data, error: null }
    }

    const signOut = async () => {
        const { error } = await supabase.auth.signOut()

        if (!error) {
            user.value = null
            role.value = 'guest'
            isExaminer.value = false
            examinerProfile.value = null
        }

        return { error }
    }

    // Watch for changes in the supabase user state and sync with our local state
    watch(supabaseUser, (newUser) => {
        user.value = newUser
        if (!newUser) {
            role.value = 'guest'
            isExaminer.value = false
            examinerProfile.value = null
        }
    }, { immediate: true })

    // Helper functions for role checking
    const isAdmin = () => role.value === 'admin'
    const isUser = () => role.value === 'user'
    const isAuthenticated = () => !!user.value
    // Independent of role -- true for BOTH admin-who-is-also-examiner
    // and pure (role === 'examiner') examiners.
    const isExaminerUser = () => isExaminer.value

    return {
        user, // Global reactive user state
        role, // Primary role: 'admin' | 'examiner' | 'user' | 'guest'
        isExaminer, // Independent capability flag -- can be true even when role === 'admin'
        examinerProfile, // { id, name } when isExaminer is true, else null
        getUser,
        signInWithGoogle,
        signOut,
        // Helper functions
        isAdmin,
        isUser,
        isAuthenticated,
        isExaminerUser,
    }
}
