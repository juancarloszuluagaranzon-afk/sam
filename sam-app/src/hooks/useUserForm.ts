import { useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'

interface UserFormState {
  id: string
  nombreCompleto: string
  rol: string
  pin: string
  equipoCodigo: string
  zona: string
}

const EMPTY_USER_FORM: UserFormState = {
  id: '',
  nombreCompleto: '',
  rol: '',
  pin: '',
  equipoCodigo: '',
  zona: '',
}

export function useUserForm() {
  const { users } = useAppData()

  const [userForm, setUserForm] = useState<UserFormState>(EMPTY_USER_FORM)
  const [isUserFormOpen, setIsUserFormOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [userSearch, setUserSearch] = useState('')

  const nextUserId = useMemo(() => {
    const nums = users
      .map((u) => parseInt(u.id.replace(/^U/i, ''), 10))
      .filter((n) => !isNaN(n))
    const max = nums.length ? Math.max(...nums) : 0
    return `U${String(max + 1).padStart(3, '0')}`
  }, [users])

  return {
    userForm,
    setUserForm,
    isUserFormOpen,
    setIsUserFormOpen,
    editingUserId,
    setEditingUserId,
    userSearch,
    setUserSearch,
    nextUserId,
  }
}
