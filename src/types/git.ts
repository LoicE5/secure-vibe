/** Host git identity forwarded into the container so commits are attributed correctly. */
export interface GitIdentity {
  name: string
  email: string
}
