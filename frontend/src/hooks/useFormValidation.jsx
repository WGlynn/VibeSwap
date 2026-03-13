import { useState, useCallback, useMemo } from 'react'

// ============================================================
// useFormValidation — Generic form validation hook
// Used for any form: swap, bridge, token creation, settings
// ============================================================

export function useFormValidation(initialValues = {}, validators = {}) {
  const [values, setValues] = useState(initialValues)
  const [touched, setTouched] = useState({})

  const errors = useMemo(() => {
    const errs = {}
    Object.entries(validators).forEach(([key, validate]) => {
      const err = validate(values[key], values)
      if (err) errs[key] = err
    })
    return errs
  }, [values, validators])

  const setValue = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const setFieldTouched = useCallback((key) => {
    setTouched((prev) => ({ ...prev, [key]: true }))
  }, [])

  const handleChange = useCallback((key) => (e) => {
    const val = e?.target ? e.target.value : e
    setValue(key, val)
  }, [setValue])

  const handleBlur = useCallback((key) => () => {
    setFieldTouched(key)
  }, [setFieldTouched])

  const reset = useCallback(() => {
    setValues(initialValues)
    setTouched({})
  }, [initialValues])

  const isValid = Object.keys(errors).length === 0
  const visibleErrors = {}
  Object.keys(errors).forEach((key) => {
    if (touched[key]) visibleErrors[key] = errors[key]
  })

  return {
    values,
    errors: visibleErrors,
    allErrors: errors,
    touched,
    isValid,
    setValue,
    setFieldTouched,
    handleChange,
    handleBlur,
    reset,
  }
}
