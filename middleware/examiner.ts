import { defineNuxtRouteMiddleware, navigateTo } from "nuxt/app"

// Gates /examiner/* routes. Checks the independent `isExaminer`
// capability (see useAuth.ts), NOT `role` -- an admin who is also an
// examiner has role === 'admin' but isExaminer === true, and must
// still be let through here.
export default defineNuxtRouteMiddleware(async () => {
    const { role, isExaminer, getUser } = useAuth()

    // Ensure we have the latest user/examiner data
    await getUser()

    if (!isExaminer.value) {
        // Send them somewhere sensible for what they actually are,
        // rather than a generic "not authorized" dead end.
        if (role.value === 'admin') return navigateTo("/admin/dashboard")
        if (role.value === 'user') return navigateTo("/students/dashboard")
        return navigateTo("/")
    }
})
