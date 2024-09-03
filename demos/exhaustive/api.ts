import { declareRoutine, declareScalarRoutine } from 'pg-nano'

export declare namespace getFoo {
  export type Params = {id: number}
}

export const getFoo = declareRoutine<getFoo.Params, unknown>("get_foo", ["id"])

export declare namespace createAccount {
  export type Params = {username: string, email: string, password: string, salt: string, firstName?: string, lastName?: string, dateOfBirth?: string}
}

export const createAccount = declareScalarRoutine<createAccount.Params, number>("create_account", ["username","email","password","salt","firstName","lastName","dateOfBirth"])

export const deleteAccount = declareScalarRoutine<[number], boolean>("delete_account")
